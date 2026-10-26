import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../../../core/db/client.js";
import { virtualAccounts, walletLedger, wallets } from "../../../core/db/schema.js";
import { ValidationError } from "../../../core/errors/ValidationError.js";
import { InsufficientBalanceError } from "../../../core/errors/AppError.js";
import { centsToMoneyString } from "../../../core/utils/money.js";

// Anything that can run a query: the db itself or an open transaction.
export type Executor = Pick<typeof db, "select" | "insert" | "update" | "execute">;

export type EntryType =
  | "deposit"
  | "purchase"
  | "payout"
  | "fee"
  | "refund"
  | "reversal"
  | "transfer_in"
  | "transfer_out"
  | "adjustment";

export type RelatedType = "deposit" | "vtu_order" | "payout" | "transfer" | "adjustment";

export type LedgerEntry = typeof walletLedger.$inferSelect;

export async function findWalletByUser(userId: string, ex: Executor = db) {
  const rows = await ex.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
  return rows[0] ?? null;
}

// Every user has exactly one NGN wallet (unique user_id).
export async function getOrCreateWallet(userId: string, ex: Executor = db) {
  const existing = await findWalletByUser(userId, ex);
  if (existing) return existing;
  await ex.insert(wallets).values({ userId }).onConflictDoNothing({ target: wallets.userId });
  const created = await findWalletByUser(userId, ex);
  if (!created) throw new Error("Failed to create wallet");
  return created;
}

export async function findActiveVirtualAccount(walletId: string, ex: Executor = db) {
  const rows = await ex
    .select()
    .from(virtualAccounts)
    .where(and(eq(virtualAccounts.walletId, walletId), eq(virtualAccounts.status, "active")))
    .limit(1);
  return rows[0] ?? null;
}

export async function listLedgerByWallet(walletId: string, limit: number) {
  return db
    .select()
    .from(walletLedger)
    .where(eq(walletLedger.walletId, walletId))
    .orderBy(desc(walletLedger.createdAt))
    .limit(limit);
}

export async function findLedgerByIdForUser(id: string, userId: string) {
  const rows = await db
    .select()
    .from(walletLedger)
    .where(and(eq(walletLedger.id, id), eq(walletLedger.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findLedgerByReference(reference: string, ex: Executor = db) {
  const rows = await ex.select().from(walletLedger).where(eq(walletLedger.reference, reference)).limit(1);
  return rows[0] ?? null;
}

// Moves money through app.post_entry, the only path the database accepts.
// Idempotent on `reference`: a replay returns the original line.
export async function postEntry(
  ex: Executor,
  input: {
    walletId: string;
    direction: "credit" | "debit";
    amountCents: bigint;
    entryType: EntryType;
    reference: string;
    description: string;
    relatedType?: RelatedType;
    relatedId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<LedgerEntry> {
  if (input.amountCents <= 0n) throw new ValidationError("Amount must be positive");
  try {
    const res = await ex.execute(sql`
      select * from app.post_entry(
        ${input.walletId}::uuid, ${input.direction}, ${centsToMoneyString(input.amountCents)}::numeric,
        ${input.entryType}, ${input.reference}, ${input.description},
        ${input.relatedType ?? null}, ${input.relatedId ?? null}::uuid,
        ${input.metadata ? JSON.stringify(input.metadata) : null}::jsonb
      )`);
    const r = res.rows[0] as Record<string, any>;
    return {
      id: r.id,
      walletId: r.wallet_id,
      userId: r.user_id,
      entryType: r.entry_type,
      direction: r.direction,
      amount: r.amount,
      balanceBefore: r.balance_before,
      balanceAfter: r.balance_after,
      reference: r.reference,
      relatedType: r.related_type,
      relatedId: r.related_id,
      description: r.description,
      metadata: r.metadata,
      createdAt: r.created_at,
    };
  } catch (err: any) {
    const code = err?.code ?? err?.cause?.code;
    if (code === "WL001") throw new InsufficientBalanceError();
    if (code === "WL002") throw new ValidationError("Your wallet is not active");
    if (code === "WL003") throw new ValidationError("This reference was already used for a different transaction");
    if (code === "WL006") throw new ValidationError("Invalid amount");
    if (code === "WL007") throw new ValidationError("Wallet not found");
    throw err;
  }
}
