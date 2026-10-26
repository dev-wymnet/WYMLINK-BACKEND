import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "../../core/db/client.js";
import { vtuOrders } from "../../core/db/schema.js";
import { NotFoundError } from "../../core/errors/NotFoundError.js";
import { ValidationError } from "../../core/errors/ValidationError.js";
import { logger } from "../../core/logger/logger.js";
import { centsToMoneyString, parseMoneyToCents } from "../../core/utils/money.js";
import { enforceSpendLimit } from "../compliance/service/limits.service.js";
import { getOrCreateWallet, postEntry } from "../wallet/repository/wallet.repository.js";
import type { ProviderOutcome } from "./providers/types.js";

export type VtuOrder = typeof vtuOrders.$inferSelect;
export type Product = "airtime" | "data" | "cable" | "electricity";

export type OrderSpec = {
  userId: string;
  reference: string;
  product: Product;
  provider: "peyflex" | "reloadly";
  service: string;
  planCode?: string | null;
  planName?: string | null;
  recipient: string;
  recipientName?: string | null;
  meterType?: "prepaid" | "postpaid" | null;
  amountCents: bigint;
  description: string;
};

const LABEL: Record<Product, string> = {
  airtime: "Airtime",
  data: "Data",
  cable: "Cable TV",
  electricity: "Electricity",
};

const isUniqueViolation = (err: any) => (err?.code ?? err?.cause?.code) === "23505";

// API shape (stable for the web and mobile apps). `status` is what the apps
// show: success | pending | failed (refunded orders read as failed).
export function toOrderDto(o: VtuOrder) {
  const status = o.status === "success" ? "success" : o.status === "failed" || o.status === "refunded" ? "failed" : "pending";
  return {
    id: o.id,
    reference: o.reference,
    product: o.product,
    provider: o.provider,
    service: o.service,
    planCode: o.planCode,
    planName: o.planName,
    recipient: o.recipient,
    recipientName: o.recipientName,
    meterType: o.meterType,
    amount: o.amount,
    status,
    orderStatus: o.status,
    refunded: o.status === "refunded",
    token: o.token,
    units: o.units,
    lastError: status === "failed" ? o.lastError : null,
    providerResponse: o.product === "electricity" && o.token ? { token: o.token, units: o.units } : null,
    createdAt: o.createdAt,
    completedAt: o.completedAt,
  };
}

async function findByReference(reference: string) {
  const rows = await db.select().from(vtuOrders).where(eq(vtuOrders.reference, reference)).limit(1);
  return rows[0] ?? null;
}

// A replayed reference returns the original order and is never sent again.
function replay(existing: VtuOrder, spec: OrderSpec) {
  if (existing.userId !== spec.userId) throw new ValidationError("This reference was already used. Start a new purchase.");
  return existing;
}

// Debits the wallet and records the order in one transaction, then calls the
// provider exactly once. Outcome: success; failed → refunded at once; unknown
// → held for staff to resolve (never resent, never auto-refunded).
export async function placeOrder(spec: OrderSpec, send: () => Promise<ProviderOutcome>) {
  if (spec.amountCents <= 0n) throw new ValidationError("Invalid amount");

  const existing = await findByReference(spec.reference);
  if (existing) return replay(existing, spec);

  let order: VtuOrder;
  try {
    order = await db.transaction(async (tx) => {
      await enforceSpendLimit(tx, { userId: spec.userId, amountCents: spec.amountCents });
      const wallet = await getOrCreateWallet(spec.userId, tx);
      const [created] = await tx
        .insert(vtuOrders)
        .values({
          userId: spec.userId,
          walletId: wallet.id,
          reference: spec.reference,
          product: spec.product,
          provider: spec.provider,
          service: spec.service,
          planCode: spec.planCode ?? null,
          planName: spec.planName ?? null,
          recipient: spec.recipient,
          recipientName: spec.recipientName ?? null,
          meterType: spec.meterType ?? null,
          amount: centsToMoneyString(spec.amountCents),
          status: "processing",
          attempts: 1,
        })
        .returning();
      const debit = await postEntry(tx, {
        walletId: wallet.id,
        direction: "debit",
        amountCents: spec.amountCents,
        entryType: "purchase",
        reference: `vtu:${created!.id}`,
        description: spec.description,
        relatedType: "vtu_order",
        relatedId: created!.id,
      });
      const [linked] = await tx
        .update(vtuOrders)
        .set({ debitEntryId: debit.id })
        .where(eq(vtuOrders.id, created!.id))
        .returning();
      return linked!;
    });
  } catch (err) {
    // Two requests raced with one reference: the loser returns the winner's order.
    if (isUniqueViolation(err)) {
      const raced = await findByReference(spec.reference);
      if (raced) return replay(raced, spec);
    }
    throw err;
  }

  let outcome: ProviderOutcome;
  try {
    outcome = await send();
  } catch (err) {
    // Provider not configured or unreachable before sending: nothing was delivered.
    outcome = { status: "failed", message: err instanceof Error ? err.message : "Provider unavailable", raw: null };
  }
  return recordOutcome(order, outcome);
}

async function recordOutcome(order: VtuOrder, outcome: ProviderOutcome): Promise<VtuOrder> {
  const common = {
    providerReference: outcome.providerReference ?? order.providerReference,
    providerResponse: outcome.raw as any,
    lastError: outcome.status === "success" ? null : (outcome.message ?? null),
  };

  if (outcome.status === "success") {
    const [done] = await db
      .update(vtuOrders)
      .set({ ...common, status: "success", token: outcome.token ?? null, units: outcome.units ?? null, completedAt: new Date(), nextCheckAt: null })
      .where(eq(vtuOrders.id, order.id))
      .returning();
    logger.info({ orderId: order.id, product: order.product }, "vtu_order_success");
    return done!;
  }

  if (outcome.status === "failed") {
    await db.update(vtuOrders).set({ ...common, status: "failed" }).where(eq(vtuOrders.id, order.id));
    const refunded = await refundOrder(order.id, `${LABEL[order.product as Product]} purchase failed — refunded`);
    logger.info({ orderId: order.id, product: order.product }, "vtu_order_failed_refunded");
    return refunded;
  }

  const [held] = await db
    .update(vtuOrders)
    .set({ ...common, status: "unknown", nextCheckAt: new Date(Date.now() + 10 * 60_000) })
    .where(eq(vtuOrders.id, order.id))
    .returning();
  logger.warn({ orderId: order.id, product: order.product }, "vtu_order_outcome_unknown");
  return held!;
}

// Credits the order's amount back exactly once (idempotent ledger reference).
export async function refundOrder(orderId: string, description: string): Promise<VtuOrder> {
  return db.transaction(async (tx) => {
    const [o] = await tx.select().from(vtuOrders).where(eq(vtuOrders.id, orderId)).for("update");
    if (!o) throw new NotFoundError("Order not found");
    if (o.status === "refunded") return o;
    if (o.status === "success") throw new ValidationError("A delivered order can't be refunded here");
    const credit = await postEntry(tx, {
      walletId: o.walletId,
      direction: "credit",
      amountCents: parseMoneyToCents(o.amount),
      entryType: "refund",
      reference: `vtu:${o.id}:refund`,
      description,
      relatedType: "vtu_order",
      relatedId: o.id,
    });
    const [done] = await tx
      .update(vtuOrders)
      .set({ status: "refunded", refundEntryId: credit.id, completedAt: new Date(), nextCheckAt: null })
      .where(eq(vtuOrders.id, o.id))
      .returning();
    return done!;
  });
}

// Staff resolution of an order whose outcome the provider never confirmed.
export async function resolveOrder(input: { orderId: string; decision: "delivered" | "refund"; note?: string | undefined }) {
  const rows = await db.select().from(vtuOrders).where(eq(vtuOrders.id, input.orderId)).limit(1);
  const o = rows[0];
  if (!o) throw new NotFoundError("Order not found");
  if (!["unknown", "processing", "pending"].includes(o.status)) {
    throw new ValidationError(`This order is already ${o.status}`);
  }
  if (input.decision === "delivered") {
    const [done] = await db
      .update(vtuOrders)
      .set({ status: "success", completedAt: new Date(), nextCheckAt: null, lastError: input.note ?? null })
      .where(and(eq(vtuOrders.id, o.id), inArray(vtuOrders.status, ["unknown", "processing", "pending"])))
      .returning();
    if (!done) throw new ValidationError("This order changed while you were reviewing it");
    return done;
  }
  return refundOrder(o.id, `${LABEL[o.product as Product]} purchase not delivered — refunded`);
}

export async function listMyOrders(userId: string, limit: number) {
  return db.select().from(vtuOrders).where(eq(vtuOrders.userId, userId)).orderBy(desc(vtuOrders.createdAt)).limit(limit);
}

export async function getMyOrder(userId: string, id: string) {
  const rows = await db.select().from(vtuOrders).where(and(eq(vtuOrders.id, id), eq(vtuOrders.userId, userId))).limit(1);
  if (!rows[0]) throw new NotFoundError("Order not found");
  return rows[0];
}
