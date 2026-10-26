import { and, desc, eq, or, sql } from "drizzle-orm";

import { db } from "../../core/db/client.js";
import { transfers, users, virtualAccounts } from "../../core/db/schema.js";
import { NotFoundError } from "../../core/errors/NotFoundError.js";
import { ValidationError } from "../../core/errors/ValidationError.js";
import { logger } from "../../core/logger/logger.js";
import { normalizeEmail, normalizePhone } from "../../core/utils/identity.js";
import { centsToMoneyString, parseMoneyToCents } from "../../core/utils/money.js";
import { enforceSpendLimit } from "../compliance/service/limits.service.js";
import { postEntry } from "../wallet/repository/wallet.repository.js";
import { transferBetweenAccounts, type MoneyOutcome } from "../moneta/moneta.partner.js";
import { getMyVirtualAccount } from "./account.service.js";

export type Transfer = typeof transfers.$inferSelect;
const isUniqueViolation = (err: any) => (err?.code ?? err?.cause?.code) === "23505";

export function toTransferDto(t: Transfer, viewerId: string, names: { sender?: string; recipient?: string } = {}) {
  const outgoing = t.senderUserId === viewerId;
  return {
    id: t.id,
    reference: t.reference,
    direction: outgoing ? "outgoing" : "incoming",
    amount: t.amount,
    narration: t.narration,
    counterparty: outgoing ? (names.recipient ?? null) : (names.sender ?? null),
    status: t.status === "success" ? "success" : t.status === "reversed" ? "failed" : "pending",
    refunded: t.status === "reversed",
    createdAt: t.createdAt,
    completedAt: t.completedAt,
  };
}

// A Wymlink customer who can receive money: by phone, email or Wymlink account number.
export async function findRecipient(query: string, senderId: string) {
  const q = query.trim();
  let where;
  if (/^\d{10}$/.test(q) && !q.startsWith("0")) where = eq(virtualAccounts.accountNumber, q);
  else if (q.includes("@")) where = eq(users.email, normalizeEmail(q));
  else if (/^\d{10}$/.test(q)) {
    // 10 digits starting with 0 could be either; try the account number first.
    const byAccount = await db
      .select({ user: users, va: virtualAccounts })
      .from(virtualAccounts)
      .innerJoin(users, eq(users.id, virtualAccounts.userId))
      .where(and(eq(virtualAccounts.accountNumber, q), eq(virtualAccounts.status, "active")))
      .limit(1);
    if (byAccount[0]) return check(byAccount[0], senderId);
    where = eq(users.phone, normalizePhone(q));
  } else where = eq(users.phone, normalizePhone(q));

  const rows = await db
    .select({ user: users, va: virtualAccounts })
    .from(users)
    .innerJoin(virtualAccounts, and(eq(virtualAccounts.userId, users.id), eq(virtualAccounts.status, "active")))
    .where(where)
    .limit(1);
  if (!rows[0]) throw new NotFoundError("No Wymlink account found. Check the details, or send to their bank instead.");
  return check(rows[0], senderId);
}

function check(row: { user: typeof users.$inferSelect; va: typeof virtualAccounts.$inferSelect }, senderId: string) {
  if (row.user.id === senderId) throw new ValidationError("You can't send money to yourself");
  if (row.user.status !== "active" || row.user.role !== "customer") throw new NotFoundError("No Wymlink account found.");
  return { userId: row.user.id, name: `${row.user.firstName} ${row.user.lastName}`.trim(), accountNumber: row.va.accountNumber, va: row.va };
}

async function findMine(senderId: string, reference: string) {
  const rows = await db.select().from(transfers).where(and(eq(transfers.senderUserId, senderId), eq(transfers.reference, reference))).limit(1);
  return rows[0] ?? null;
}

// Debits the sender (one transaction), moves the money between the two Moneta
// accounts once, then credits the recipient only after Moneta confirms.
export async function createTransfer(input: { senderId: string; reference: string; recipient: string; amountCents: bigint; narration?: string | undefined }) {
  const existing = await findMine(input.senderId, input.reference);
  if (existing) return existing;
  if (input.amountCents < 10_000n) throw new ValidationError("The minimum transfer is ₦100");

  const senderVa = await getMyVirtualAccount(input.senderId);
  if (!senderVa) throw new ValidationError("Get your account number first: transfers are sent from it.");
  const to = await findRecipient(input.recipient, input.senderId);

  let t: Transfer;
  try {
    t = await db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from app.wallets where id = ${senderVa.walletId}::uuid for update`);
      await enforceSpendLimit(tx, { userId: input.senderId, amountCents: input.amountCents });
      const [created] = await tx
        .insert(transfers)
        .values({
          reference: input.reference,
          senderUserId: input.senderId,
          senderWalletId: senderVa.walletId,
          recipientUserId: to.userId,
          recipientWalletId: to.va.walletId,
          amount: centsToMoneyString(input.amountCents),
          narration: input.narration?.slice(0, 120) ?? null,
          status: "processing",
        })
        .returning();
      const debit = await postEntry(tx, {
        walletId: senderVa.walletId,
        direction: "debit",
        amountCents: input.amountCents,
        entryType: "transfer_out",
        reference: `transfer:${created!.id}:out`,
        description: `Sent to ${to.name}`,
        relatedType: "transfer",
        relatedId: created!.id,
      });
      const [linked] = await tx.update(transfers).set({ debitEntryId: debit.id }).where(eq(transfers.id, created!.id)).returning();
      return linked!;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const raced = await findMine(input.senderId, input.reference);
      if (raced) return raced;
    }
    throw err;
  }

  let outcome: MoneyOutcome;
  try {
    outcome = await transferBetweenAccounts({
      sourceAccountNumber: senderVa.accountNumber,
      destinationAccountNumber: to.accountNumber,
      amount: Number(centsToMoneyString(input.amountCents)),
    });
  } catch (err) {
    outcome = { status: "failed", providerReference: null, fee: null, message: (err as Error).message, raw: null };
  }
  return applyOutcome(t, outcome);
}

async function applyOutcome(t: Transfer, outcome: MoneyOutcome): Promise<Transfer> {
  if (outcome.status === "unknown") {
    const [held] = await db
      .update(transfers)
      .set({ status: "unknown", lastError: outcome.message, providerReference: outcome.providerReference })
      .where(and(eq(transfers.id, t.id), eq(transfers.status, "processing")))
      .returning();
    logger.warn({ transferId: t.id }, "transfer_outcome_unknown");
    return held ?? t;
  }
  return outcome.status === "success" ? completeTransfer(t.id, outcome.providerReference) : reverseTransfer(t.id, outcome.message ?? "Declined");
}

async function names(t: Transfer) {
  const rows = await db.select({ id: users.id, first: users.firstName, last: users.lastName }).from(users).where(or(eq(users.id, t.senderUserId), eq(users.id, t.recipientUserId)));
  const name = (id: string) => {
    const u = rows.find((r) => r.id === id);
    return u ? `${u.first} ${u.last}`.trim() : "Wymlink customer";
  };
  return { sender: name(t.senderUserId), recipient: name(t.recipientUserId) };
}

async function completeTransfer(id: string, providerReference: string | null): Promise<Transfer> {
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(transfers).where(eq(transfers.id, id)).for("update");
    if (!t) throw new NotFoundError("Transfer not found");
    if (t.status === "success" || t.status === "reversed") return t;
    const n = await names(t);
    const credit = await postEntry(tx, {
      walletId: t.recipientWalletId,
      direction: "credit",
      amountCents: parseMoneyToCents(t.amount),
      entryType: "transfer_in",
      reference: `transfer:${t.id}:in`,
      description: `Received from ${n.sender}`,
      relatedType: "transfer",
      relatedId: t.id,
    });
    const [done] = await tx
      .update(transfers)
      .set({ status: "success", creditEntryId: credit.id, providerReference: providerReference ?? t.providerReference, lastError: null, completedAt: new Date() })
      .where(eq(transfers.id, t.id))
      .returning();
    logger.info({ transferId: t.id }, "transfer_success");
    return done!;
  });
}

async function reverseTransfer(id: string, reason: string): Promise<Transfer> {
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(transfers).where(eq(transfers.id, id)).for("update");
    if (!t) throw new NotFoundError("Transfer not found");
    if (t.status === "success" || t.status === "reversed") return t;
    const credit = await postEntry(tx, {
      walletId: t.senderWalletId,
      direction: "credit",
      amountCents: parseMoneyToCents(t.amount),
      entryType: "reversal",
      reference: `transfer:${t.id}:reversal`,
      description: "Transfer failed — refunded",
      relatedType: "transfer",
      relatedId: t.id,
    });
    const [done] = await tx
      .update(transfers)
      .set({ status: "reversed", reversalEntryId: credit.id, lastError: reason.slice(0, 300), completedAt: new Date() })
      .where(eq(transfers.id, t.id))
      .returning();
    logger.info({ transferId: t.id }, "transfer_reversed");
    return done!;
  });
}

export async function listMyTransfers(userId: string, limit: number) {
  const rows = await db
    .select()
    .from(transfers)
    .where(or(eq(transfers.senderUserId, userId), and(eq(transfers.recipientUserId, userId), eq(transfers.status, "success"))))
    .orderBy(desc(transfers.createdAt))
    .limit(limit);
  return Promise.all(rows.map(async (t) => toTransferDto(t, userId, await names(t))));
}

export async function getMyTransfer(userId: string, id: string) {
  const rows = await db.select().from(transfers).where(eq(transfers.id, id)).limit(1);
  const t = rows[0];
  if (!t || (t.senderUserId !== userId && !(t.recipientUserId === userId && t.status === "success"))) throw new NotFoundError("Transfer not found");
  return toTransferDto(t, userId, await names(t));
}

export async function transferDtoFor(t: Transfer, viewerId: string) {
  return toTransferDto(t, viewerId, await names(t));
}

// Staff settlement of an unconfirmed transfer (after checking Moneta's transfer history).
export async function resolveTransfer(input: { transferId: string; decision: "success" | "reverse" }) {
  const rows = await db.select().from(transfers).where(eq(transfers.id, input.transferId)).limit(1);
  const t = rows[0];
  if (!t) throw new NotFoundError("Transfer not found");
  if (!["unknown", "processing"].includes(t.status)) throw new ValidationError(`This transfer is already ${t.status}`);
  return input.decision === "success" ? completeTransfer(t.id, t.providerReference) : reverseTransfer(t.id, "Reversed by staff");
}
