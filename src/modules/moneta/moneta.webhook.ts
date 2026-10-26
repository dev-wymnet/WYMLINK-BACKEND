import { createHash } from "node:crypto";
import { Router, type RequestHandler } from "express";

import { db } from "../../core/db/client.js";
import { providerEvents } from "../../core/db/schema.js";
import { logger } from "../../core/logger/logger.js";
import { limiter } from "../../core/middleware/rateLimits.js";
import { safeIp } from "../../core/utils/identity.js";

// Moneta payment notifications (deposits into customers' virtual accounts).
//
// Moneta hasn't shared its notification format or how it signs them yet, so
// for now every notification is only RECORDED in app.provider_events (status
// "received") and acknowledged. Nothing is credited from here until the
// signature check and payload mapping are written; a forged notification
// therefore can't move money. Deposits are credited after they are confirmed
// against Moneta's own transaction history.

// Headers worth keeping (the signature header, once known, is among them).
const keepHeader = (name: string) => /^(x-|content-type$|user-agent$|signature|authorization-signature)/i.test(name);

const receive: RequestHandler = async (req, res) => {
  const raw = (req as any).rawBody as Buffer | undefined;
  const body = req.body && Object.keys(req.body).length ? req.body : raw ? { raw: raw.toString("utf8").slice(0, 20_000) } : {};
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = body?.[k] ?? body?.data?.[k];
      if (typeof v === "string" || typeof v === "number") return String(v).slice(0, 200);
    }
    return null;
  };

  const eventId =
    pick("event_id", "eventId", "id", "transaction_reference", "transactionReference", "session_id", "sessionId") ??
    createHash("sha256").update(raw ?? JSON.stringify(body)).digest("hex");
  const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => keepHeader(k)));

  try {
    await db
      .insert(providerEvents)
      .values({
        provider: "moneta",
        eventId,
        eventType: pick("event", "event_type", "eventType", "type", "notification_type") ?? "unknown",
        reference: pick("reference", "transaction_reference", "virtual_account_reference", "account_number"),
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
};

export const monetaWebhookRoutes = Router();
monetaWebhookRoutes.post("/moneta", limiter({ windowMs: 60 * 1000, max: 300 }), receive);
