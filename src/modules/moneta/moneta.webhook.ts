import { createHash } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { and, eq, sql } from "drizzle-orm";

import { db } from "../../core/db/client.js";
import { providerEvents } from "../../core/db/schema.js";
import { logger } from "../../core/logger/logger.js";
import { limiter } from "../../core/middleware/rateLimits.js";
import { safeIp } from "../../core/utils/identity.js";
import { findVirtualAccountByProviderRef, syncDeposits } from "../banking/account.service.js";

// Moneta payment notifications (deposits into customers' virtual accounts).
//
// Moneta hasn't shared how it signs notifications, so a notification is never
// trusted on its own: it is recorded in app.provider_events and acknowledged,
// then only *prompts* a read of that account's history from Moneta itself
// (syncDeposits). Wallets are credited from Moneta's history, so a forged
// notification can't move money; at most it costs one history read.

// Headers worth keeping (the signature header, once known, is among them).
const keepHeader = (name: string) => /^(x-|content-type$|user-agent$|signature|authorization-signature)/i.test(name);

const receive: RequestHandler = async (req, res) => {
  const raw = (req as any).rawBody as Buffer | undefined;
  const body = req.body && Object.keys(req.body).length ? req.body : raw ? { raw: raw.toString("utf8").slice(0, 20_000) } : {};
  // A key is looked up at the top level and under `data`; a dotted key ("payment.reference")
  // is a path. Moneta's deposit notification (seen live) is
  // { notification_type, payment: {reference, paid_at, amount_paid, …}, virtualAccount: {reference, account_number, …} }.
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const at = (o: any) => k.split(".").reduce((x, part) => x?.[part], o);
      const v = at(body) ?? at(body?.data);
      if (typeof v === "string" || typeof v === "number") return String(v).slice(0, 200);
    }
    return null;
  };

  const eventId =
    pick("event_id", "eventId", "id", "transaction_reference", "transactionReference", "session_id", "sessionId", "payment.reference") ??
    createHash("sha256").update(raw ?? JSON.stringify(body)).digest("hex");
  const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => keepHeader(k)));

  try {
    await db
      .insert(providerEvents)
      .values({
        provider: "moneta",
        eventId,
        eventType: pick("event", "event_type", "eventType", "type", "notification_type") ?? "unknown",
        reference: pick("reference", "transaction_reference", "payment.reference", "virtual_account_reference", "virtualAccount.reference", "account_number"),
        payload: { body, headers, ip: safeIp(req.ip), receivedAt: new Date().toISOString() },
      })
      .onConflictDoNothing({ target: [providerEvents.provider, providerEvents.eventId] });
    logger.info({ eventId }, "moneta_notification_recorded");
  } catch (err) {
    logger.error({ err }, "moneta_notification_store_failed");
    // A 5xx asks Moneta to retry later instead of losing the notification.
    return res.status(500).json({ received: false });
  }
  res.status(200).json({ received: true });

  // After answering: confirm against Moneta and credit what its history shows.
  void (async () => {
    const va = await findVirtualAccountByProviderRef(
      pick("virtual_account_reference", "virtualAccountReference", "account_reference", "virtualAccount.reference"),
      pick("account_number", "accountNumber", "virtual_account_number", "destination_account_number", "virtualAccount.account_number"),
    );
    if (!va) {
      await db.update(providerEvents).set({ status: "ignored", processedAt: new Date() }).where(and(eq(providerEvents.provider, "moneta"), eq(providerEvents.eventId, eventId)));
      return;
    }
    const fresh = await syncDeposits(va);
    await db.update(providerEvents).set({ status: "processed", processedAt: new Date() }).where(and(eq(providerEvents.provider, "moneta"), eq(providerEvents.eventId, eventId)));
    logger.info({ eventId, credited: fresh.length }, "moneta_notification_synced");
  })().catch(async (err) => {
    logger.error({ eventId, err: (err as Error).message }, "moneta_notification_sync_failed");
    await db
      .update(providerEvents)
      .set({ status: "failed", lastError: String((err as Error).message).slice(0, 300), attempts: sql`${providerEvents.attempts} + 1` })
      .where(and(eq(providerEvents.provider, "moneta"), eq(providerEvents.eventId, eventId)))
      .catch(() => undefined);
  });
};

export const monetaWebhookRoutes = Router();
monetaWebhookRoutes.post("/moneta", limiter({ windowMs: 60 * 1000, max: 300 }), receive);
