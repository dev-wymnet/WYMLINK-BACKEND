import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { env } from "../../core/config/env.js";
import { db } from "../../core/db/client.js";
import { beneficiaries, payouts } from "../../core/db/schema.js";
import { NotFoundError } from "../../core/errors/NotFoundError.js";
import { ValidationError } from "../../core/errors/ValidationError.js";
import { logger } from "../../core/logger/logger.js";
import { centsToMoneyString, parseMoneyToCents } from "../../core/utils/money.js";
import { enforceSpendLimit } from "../compliance/service/limits.service.js";
import { getOrCreateWallet, postEntry } from "../wallet/repository/wallet.repository.js";
import { findPayout, listBanks, payout, resolveAccount, type MoneyOutcome } from "../moneta/moneta.partner.js";
import { getMyVirtualAccount } from "./account.service.js";

export type Payout = typeof payouts.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const feeCents = () => parseMoneyToCents(env.MONETA_PAYOUT_FEE.toFixed(2));
const isUniqueViolation = (err: any) => (err?.code ?? err?.cause?.code) === "23505";

// Every payout's narration starts with a tag (WYM + 10 chars) so an unconfirmed
// payout can be found again in Moneta's payout history.
const tagOf = (p: Payout) => p.narration.split(" ")[0]!;

// API shape. `status` is what the apps show: success | processing | pending | failed.
export function toPayoutDto(p: Payout) {
  const status = p.status === "success" ? "success" : p.status === "reversed" || p.status === "failed" ? "failed" : p.status === "unknown" ? "pending" : "processing";
  return {
    id: p.id,
    reference: p.reference,
    amount: p.amount,
    fee: p.fee,
    total: centsToMoneyString(parseMoneyToCents(p.amount) + parseMoneyToCents(p.fee)),
    bankCode: p.beneficiaryBankRef,
    bankName: p.beneficiaryBankName,
    accountNumber: p.beneficiaryAccountNumber,
    accountName: p.beneficiaryAccountName,
    narration: p.narration.split(" ").slice(1).join(" "),
    status,
    refunded: p.status === "reversed",
    providerReference: p.providerReference,
    lastError: status === "failed" ? p.lastError : null,
    createdAt: p.createdAt,
    completedAt: p.completedAt,
  };
}

export async function banks() {
  return listBanks();
}

async function bankOf(code: string) {
  const bank = (await listBanks()).find((b) => b.code === code);
  if (!bank) throw new ValidationError("Choose the bank from the list");
  return bank;
}

export async function validateAccount(bankCode: string, accountNumber: string) {
  const bank = await bankOf(bankCode);
  const accountName = await resolveAccount(bank.code, accountNumber);
  if (!accountName) throw new ValidationError("We couldn't find that account. Check the number and bank.");
  return { accountNumber, accountName, bankCode: bank.code, bankName: bank.name };
}

export function quote(amountCents: bigint) {
  const fee = feeCents();
  return { amount: centsToMoneyString(amountCents), fee: centsToMoneyString(fee), total: centsToMoneyString(amountCents + fee) };
}

async function findByReference(reference: string) {
  const rows = await db.select().from(payouts).where(eq(payouts.reference, reference)).limit(1);
  return rows[0] ?? null;
}

// Name enquiry, then one transaction that records the payout and debits amount + fee,
// then exactly one Moneta call. Replaying a reference returns the original payout.
export async function createPayout(input: {
  userId: string;
  reference: string;
  amountCents: bigint;
  bankCode: string;
  accountNumber: string;
  narration: string;
}) {
  const existing = await findByReference(input.reference);
  if (existing) {
    if (existing.userId !== input.userId) throw new ValidationError("This reference was already used. Start a new transfer.");
    return existing;
  }
  if (input.amountCents < 10_000n) throw new ValidationError("The minimum transfer is ₦100");

  const va = await getMyVirtualAccount(input.userId);
  if (!va) throw new ValidationError("Get your account number first: transfers are sent from it.");
  const { accountName, bankName, bankCode } = await validateAccount(input.bankCode, input.accountNumber);
  const fee = feeCents();
  const tag = `WYM${randomBytes(8).toString("base64url").replace(/[-_]/g, "x").slice(0, 10).toUpperCase()}`;
  const narration = `${tag} ${input.narration.replace(/\s+/g, " ").trim()}`.slice(0, 120).trim();

  let p: Payout;
  try {
    p = await db.transaction(async (tx) => {
      const wallet = await getOrCreateWallet(input.userId, tx);
      await tx.execute(sql`select 1 from app.wallets where id = ${wallet.id}::uuid for update`);
      await enforceSpendLimit(tx, { userId: input.userId, amountCents: input.amountCents + fee });
      const [created] = await tx
        .insert(payouts)
        .values({
          userId: input.userId,
          walletId: wallet.id,
          reference: input.reference,
          amount: centsToMoneyString(input.amountCents),
          fee: centsToMoneyString(fee),
          beneficiaryBankCode: bankCode,
          beneficiaryBankRef: bankCode,
          beneficiaryBankName: bankName,
          beneficiaryAccountNumber: input.accountNumber,
          beneficiaryAccountName: accountName,
          narration,
          provider: "moneta",
          status: "processing",
          attempts: 1,
        })
        .returning();
      const debit = await postEntry(tx, {
        walletId: wallet.id,
        direction: "debit",
        amountCents: input.amountCents,
        entryType: "payout",
        reference: `payout:${created!.id}`,
        description: `Transfer to ${accountName} (${bankName})`,
        relatedType: "payout",
        relatedId: created!.id,
      });
      if (fee > 0n) {
        await postEntry(tx, {
          walletId: wallet.id,
          direction: "debit",
          amountCents: fee,
          entryType: "fee",
          reference: `payout:${created!.id}:fee`,
          description: "Transfer fee",
          relatedType: "payout",
          relatedId: created!.id,
        });
      }
      const [linked] = await tx.update(payouts).set({ debitEntryId: debit.id }).where(eq(payouts.id, created!.id)).returning();
      return linked!;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const raced = await findByReference(input.reference);
      if (raced && raced.userId === input.userId) return raced;
    }
    throw err;
  }

  let outcome: MoneyOutcome;
  try {
    outcome = await payout({
      sourceReference: va.providerReference,
      bankId: bankCode,
      accountNumber: input.accountNumber,
      amount: Number(centsToMoneyString(input.amountCents)),
      narration,
    });
  } catch (err) {
    // Not configured / no token: nothing was sent.
    outcome = { status: "failed", providerReference: null, fee: null, message: (err as Error).message, raw: null };
  }
  const done = await applyOutcome(p, outcome, ["processing"]);
  if (done.status === "success") await saveBeneficiary(done).catch(() => undefined);
  return done;
}

// Applies Moneta's answer to a payout still in one of `from` statuses.
async function applyOutcome(p: Payout, outcome: MoneyOutcome, from: string[]): Promise<Payout> {
  if (outcome.status === "failed") return reversePayout(p.id, outcome.message ?? "Declined", from);

  if (outcome.status === "unknown") {
    const [held] = await db
      .update(payouts)
      .set({ status: "unknown", lastError: outcome.message, providerReference: outcome.providerReference ?? p.providerReference, nextCheckAt: new Date(Date.now() + 5 * 60_000) })
      .where(and(eq(payouts.id, p.id), inArray(payouts.status, from)))
      .returning();
    logger.warn({ payoutId: p.id }, "payout_outcome_unknown");
    return held ?? (await getPayout(p.id));
  }

  return db.transaction(async (tx) => {
    const [done] = await tx
      .update(payouts)
      .set({ status: "success", lastError: null, providerReference: outcome.providerReference ?? p.providerReference, completedAt: new Date(), nextCheckAt: null })
      .where(and(eq(payouts.id, p.id), inArray(payouts.status, from)))
      .returning();
    if (!done) return getPayout(p.id, tx);
    // The ledger mirrors the customer's Moneta VA: settle any difference between the
    // quoted fee and the fee Moneta actually took.
    if (outcome.fee !== null) await settleFeeDifference(tx, done, outcome.fee);
    logger.info({ payoutId: p.id }, "payout_success");
    return getPayout(p.id, tx);
  });
}

async function settleFeeDifference(tx: Tx, p: Payout, actualFee: number) {
  const delta = parseMoneyToCents(actualFee.toFixed(2)) - parseMoneyToCents(p.fee);
  if (delta === 0n) return;
  try {
    await postEntry(tx, {
      walletId: p.walletId,
      direction: delta > 0n ? "debit" : "credit",
      amountCents: delta > 0n ? delta : -delta,
      entryType: delta > 0n ? "fee" : "refund",
      reference: `payout:${p.id}:fee-adjust`,
      description: delta > 0n ? "Transfer fee adjustment" : "Transfer fee refund",
      relatedType: "payout",
      relatedId: p.id,
    });
    await tx.update(payouts).set({ fee: actualFee.toFixed(2) }).where(eq(payouts.id, p.id));
  } catch (err) {
    // Never undo a sent payout over a fee difference; staff reconcile it.
    logger.error({ payoutId: p.id, err: (err as Error).message }, "payout_fee_adjust_failed");
  }
}

// Credits amount + fee back exactly once.
async function reversePayout(payoutId: string, reason: string, from: string[]): Promise<Payout> {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payouts).where(eq(payouts.id, payoutId)).for("update");
    if (!p) throw new NotFoundError("Transfer not found");
    if (p.status === "reversed") return p;
    if (!from.includes(p.status)) return p;
    const credit = await postEntry(tx, {
      walletId: p.walletId,
      direction: "credit",
      amountCents: parseMoneyToCents(p.amount) + parseMoneyToCents(p.fee),
      entryType: "reversal",
      reference: `payout:${p.id}:reversal`,
      description: `Transfer to ${p.beneficiaryAccountName} failed — refunded`,
      relatedType: "payout",
      relatedId: p.id,
    });
    const [done] = await tx
      .update(payouts)
      .set({ status: "reversed", reversalEntryId: credit.id, lastError: reason.slice(0, 300), completedAt: new Date(), nextCheckAt: null })
      .where(eq(payouts.id, p.id))
      .returning();
    logger.info({ payoutId: p.id }, "payout_reversed");
    return done!;
  });
}

async function getPayout(id: string, ex: Pick<typeof db, "select"> = db) {
  const rows = await ex.select().from(payouts).where(eq(payouts.id, id)).limit(1);
  if (!rows[0]) throw new NotFoundError("Transfer not found");
  return rows[0];
}

// An unconfirmed payout is looked up in Moneta's payout history (by its narration tag).
export async function refreshPayout(p: Payout): Promise<Payout> {
  if (p.status !== "unknown" && !(p.status === "processing" && Date.now() - p.createdAt.getTime() > 3 * 60_000)) return p;
  const hit = await findPayout({ narrationTag: tagOf(p), since: p.createdAt });
  if (!hit || !hit.found || hit.status === "unknown") return p;
  return applyOutcome(p, { status: hit.status, providerReference: hit.providerReference, fee: null, message: hit.status === "failed" ? "Declined by the bank" : null, raw: null }, ["unknown", "processing"]);
}

export async function getMyPayoutByReference(userId: string, reference: string) {
  const rows = await db.select().from(payouts).where(and(eq(payouts.reference, reference), eq(payouts.userId, userId))).limit(1);
  if (!rows[0]) throw new NotFoundError("Transfer not found");
  return refreshPayout(rows[0]);
}

export async function getMyPayout(userId: string, id: string) {
  const rows = await db.select().from(payouts).where(and(eq(payouts.id, id), eq(payouts.userId, userId))).limit(1);
  if (!rows[0]) throw new NotFoundError("Transfer not found");
  return rows[0];
}

export async function listMyPayouts(userId: string, limit: number) {
  return db.select().from(payouts).where(eq(payouts.userId, userId)).orderBy(desc(payouts.createdAt)).limit(limit);
}

async function saveBeneficiary(p: Payout) {
  await db
    .insert(beneficiaries)
    .values({
      userId: p.userId,
      bankCode: p.beneficiaryBankCode,
      bankName: p.beneficiaryBankName ?? "",
      accountNumber: p.beneficiaryAccountNumber,
      accountName: p.beneficiaryAccountName,
      lastUsedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [beneficiaries.userId, beneficiaries.bankCode, beneficiaries.accountNumber],
      set: { accountName: p.beneficiaryAccountName, lastUsedAt: new Date() },
    });
}

export async function listMyBeneficiaries(userId: string) {
  return db.select().from(beneficiaries).where(eq(beneficiaries.userId, userId)).orderBy(desc(beneficiaries.lastUsedAt)).limit(50);
}

// Staff settlement of an unconfirmed payout (after checking Moneta's dashboard).
export async function resolvePayout(input: { payoutId: string; decision: "success" | "reverse"; note: string }) {
  const p = await getPayout(input.payoutId);
  if (!["unknown", "processing"].includes(p.status)) throw new ValidationError(`This transfer is already ${p.status}`);
  if (input.decision === "reverse") return reversePayout(p.id, `Reversed by staff: ${input.note}`, ["unknown", "processing"]);
  return applyOutcome(p, { status: "success", providerReference: p.providerReference, fee: null, message: null, raw: null }, ["unknown", "processing"]);
}
