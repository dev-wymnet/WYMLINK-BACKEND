import { and, desc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

import { db } from "../../../core/db/client.js";
import { walletLedger, wallets } from "../../../core/db/schema.js";
import { ValidationError } from "../../../core/errors/ValidationError.js";

function centsToNumericString(amountCents: bigint): string {
  const negative = amountCents < 0n;
  const abs = negative ? -amountCents : amountCents;
  const whole = abs / 100n;
  const frac = abs % 100n;
  const s = `${whole.toString()}.${frac.toString().padStart(2, "0")}`;
  return negative ? `-${s}` : s;
}

export async function createWalletRow(input: {
  userId: string;
  currencyCode: string;
}) {
  const rows = await db
    .insert(wallets)
    .values({
      userId: input.userId,
      currencyCode: input.currencyCode,
    })
    .onConflictDoNothing()
    .returning();

  return rows[0] ?? null;
}

export async function findWalletByUserCurrency(input: {
  userId: string;
  currencyCode: string;
}) {
  const rows = await db
    .select()
    .from(wallets)
    .where(
      and(
        eq(wallets.userId, input.userId),
        eq(wallets.currencyCode, input.currencyCode),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listLedgerByWallet(input: {
  walletId: string;
  limit: number;
}) {
  return db
    .select()
    .from(walletLedger)
    .where(eq(walletLedger.walletId, input.walletId))
    .orderBy(desc(walletLedger.createdAt))
    .limit(input.limit);
}

export async function findLedgerByIdForUser(input: {
  id: string;
  userId: string;
}) {
  const rows = await db
    .select()
    .from(walletLedger)
    .where(
      and(eq(walletLedger.id, input.id), eq(walletLedger.userId, input.userId)),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function findLedgerByReference(referenceCode: string) {
  const rows = await db
    .select()
    .from(walletLedger)
    .where(eq(walletLedger.referenceCode, referenceCode))
    .limit(1);

  return rows[0] ?? null;
}

async function creditWalletAtomicInternal(
  tx: any,
  input: {
    walletId: string;
    userId: string;
    amountCents: bigint;
    referenceCode: string;
    transactionType: "funding" | "refund" | "adjustment" | "commission";
    description: string;
    relatedOrderId?: string;
  },
) {
  const existing = await tx
    .select({ id: walletLedger.id })
    .from(walletLedger)
    .where(eq(walletLedger.referenceCode, input.referenceCode))
    .limit(1);

  if (existing[0]) return { idempotent: true as const };
  if (input.amountCents <= 0n)
    throw new ValidationError("Amount must be positive");

  const locked = await tx.execute(
    sql`select id, user_id, currency_code, available_balance, status from wallets where id = ${input.walletId} for update`,
  );

  const row = locked.rows[0] as
    | {
        id: string;
        user_id: string;
        currency_code: string;
        available_balance: string;
        status: string;
      }
    | undefined;
  if (!row) throw new ValidationError("Wallet not found");
  if (row.status !== "active") throw new ValidationError("Wallet not active");

  const before = row.available_balance;
  const amountNumeric = centsToNumericString(input.amountCents);

  const updated = await tx.execute(
    sql`update wallets set available_balance = available_balance + ${amountNumeric}::numeric, updated_at = now() where id = ${input.walletId} returning available_balance`,
  );

  const after = (updated.rows[0] as { available_balance: string })
    .available_balance;

  await tx.insert(walletLedger).values({
    walletId: input.walletId,
    userId: input.userId,
    currencyCode: row.currency_code,
    transactionType: input.transactionType,
    direction: "credit",
    amount: amountNumeric,
    balanceBefore: before,
    balanceAfter: after,
    referenceCode: input.referenceCode,
    relatedOrderId: input.relatedOrderId ?? null,
    description: input.description,
    status: "success",
  });

  return { idempotent: false as const, balanceAfter: after };
}

async function debitWalletAtomicInternal(
  tx: any,
  input: {
    walletId: string;
    userId: string;
    amountCents: bigint;
    referenceCode: string;
    transactionType: "purchase" | "adjustment" | "commission" | "payout";
    description: string;
    relatedOrderId?: string;
  },
) {
  const existing = await tx
    .select({ id: walletLedger.id })
    .from(walletLedger)
    .where(eq(walletLedger.referenceCode, input.referenceCode))
    .limit(1);

  if (existing[0]) return { idempotent: true as const };
  if (input.amountCents <= 0n) throw new Error("Amount must be positive");

  const locked = await tx.execute(
    sql`select id, user_id, currency_code, available_balance, status from wallets where id = ${input.walletId} for update`,
  );

  const row = locked.rows[0] as
    | {
        id: string;
        user_id: string;
        currency_code: string;
        available_balance: string;
        status: string;
      }
    | undefined;
  if (!row) throw new Error("Wallet not found");
  if (row.status !== "active") throw new Error("Wallet not active");

  const before = row.available_balance;
  const amountNumeric = centsToNumericString(input.amountCents);

  const check = await tx.execute(
    sql`select ((available_balance - ${amountNumeric}::numeric) < 0) as insufficient from wallets where id = ${input.walletId}`,
  );

  const insufficient = (check.rows[0] as { insufficient: boolean | null })
    .insufficient;
  if (insufficient === null || insufficient === undefined)
    throw new Error("Unable to validate balance");
  if (insufficient) throw new ValidationError("Insufficient balance");

  const updated = await tx.execute(
    sql`update wallets set available_balance = available_balance - ${amountNumeric}::numeric, updated_at = now() where id = ${input.walletId} returning available_balance`,
  );

  const after = (updated.rows[0] as { available_balance: string })
    .available_balance;

  await tx.insert(walletLedger).values({
    walletId: input.walletId,
    userId: input.userId,
    currencyCode: row.currency_code,
    transactionType: input.transactionType,
    direction: "debit",
    amount: amountNumeric,
    balanceBefore: before,
    balanceAfter: after,
    referenceCode: input.referenceCode,
    relatedOrderId: input.relatedOrderId ?? null,
    description: input.description,
    status: "success",
  });

  return { idempotent: false as const, balanceAfter: after };
}

export async function creditWalletAtomicTx(
  tx: any,
  input: {
    walletId: string;
    userId: string;
    amountCents: bigint;
    referenceCode: string;
    transactionType: "funding" | "refund" | "adjustment" | "commission";
    description: string;
    relatedOrderId?: string;
  },
) {
  return creditWalletAtomicInternal(tx, input);
}

export async function debitWalletAtomicTx(
  tx: any,
  input: {
    walletId: string;
    userId: string;
    amountCents: bigint;
    referenceCode: string;
    transactionType: "purchase" | "adjustment" | "commission" | "payout";
    description: string;
    relatedOrderId?: string;
  },
) {
  return debitWalletAtomicInternal(tx, input);
}

export async function creditWalletAtomic(input: {
  walletId: string;
  userId: string;
  amountCents: bigint;
  referenceCode: string;
  transactionType: "funding" | "refund" | "adjustment" | "commission";
  description: string;
  relatedOrderId?: string;
}) {
  return db.transaction(async (tx) => creditWalletAtomicInternal(tx, input));
}

export async function debitWalletAtomic(input: {
  walletId: string;
  userId: string;
  amountCents: bigint;
  referenceCode: string;
  transactionType: "purchase" | "adjustment" | "commission" | "payout";
  description: string;
  relatedOrderId?: string;
}) {
  return db.transaction(async (tx) => debitWalletAtomicInternal(tx, input));
}

export async function lockWalletRowTx(
  tx: any,
  walletId: string,
): Promise<{
  id: string;
  user_id: string;
  currency_code: string;
  available_balance: string;
  status: string;
} | null> {
  const locked = await tx.execute(
    sql`select id, user_id, currency_code, available_balance, status from wallets where id = ${walletId} for update`,
  );
  const row =
    (locked.rows[0] as
      | {
          id: string;
          user_id: string;
          currency_code: string;
          available_balance: string;
          status: string;
        }
      | undefined) ?? null;
  return row;
}
