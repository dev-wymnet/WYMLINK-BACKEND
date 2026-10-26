import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../../core/db/client.js";
import { deposits, kycProfiles, tierLimits, users, virtualAccounts, wallets } from "../../core/db/schema.js";
import { NotFoundError } from "../../core/errors/NotFoundError.js";
import { ValidationError } from "../../core/errors/ValidationError.js";
import { logger } from "../../core/logger/logger.js";
import { centsToMoneyString, parseMoneyToCents } from "../../core/utils/money.js";
import { unseal } from "../../core/utils/seal.js";
import { getKycProfile } from "../verification/repository/verification.repository.js";
import { matchesVerifiedBvn, matchesVerifiedIdentity } from "../verification/service/verification.service.js";
import { findActiveVirtualAccount, getOrCreateWallet, postEntry } from "../wallet/repository/wallet.repository.js";
import { createVirtualAccount, listCredits, type MonetaCredit } from "../moneta/moneta.partner.js";

export type VirtualAccount = typeof virtualAccounts.$inferSelect;
export type Deposit = typeof deposits.$inferSelect;

const naira = (n: number) => parseMoneyToCents(n.toFixed(2));

export function toVirtualAccountDto(va: VirtualAccount) {
  return { accountNumber: va.accountNumber, accountName: va.accountName, bankName: va.bankName, status: va.status, createdAt: va.createdAt };
}

export function toDepositDto(d: Deposit) {
  return {
    id: d.id,
    reference: d.providerReference,
    amountPaid: centsToMoneyString(parseMoneyToCents(d.amount) + parseMoneyToCents(d.fee)),
    fee: d.fee,
    amount: d.amount,
    senderName: d.senderName,
    status: d.status === "credited" ? "credited" : d.status === "held_for_review" ? "under_review" : d.status,
    receivedAt: d.detectedAt,
    creditedAt: d.creditedAt,
  };
}

export async function getMyVirtualAccount(userId: string) {
  const wallet = await getOrCreateWallet(userId);
  return findActiveVirtualAccount(wallet.id);
}

// Opens the customer's Moneta account (BVN in plain digits; Moneta takes a NIN placeholder,
// see createVirtualAccount), records it, and drops the encrypted BVN kept for it.
async function createAndStore(user: typeof users.$inferSelect, walletId: string, bvn: string) {
  const created = await createVirtualAccount({ firstName: user.firstName, surname: user.lastName, bvn });
  if (!created.ok) {
    logger.warn({ userId: user.id, message: created.message }, "moneta_va_create_failed");
    throw new ValidationError(`We couldn't open your account: ${created.message}`);
  }
  const [va] = await db
    .insert(virtualAccounts)
    .values({
      userId: user.id,
      walletId,
      provider: "moneta",
      providerReference: created.reference,
      accountNumber: created.accountNumber,
      accountName: created.accountName || `${user.firstName} ${user.lastName}`,
      bankName: created.bankName || "Providus Bank",
      raw: created.raw,
    })
    .returning();
  await db.update(kycProfiles).set({ bvnSealed: null }).where(eq(kycProfiles.userId, user.id));
  logger.info({ userId: user.id }, "moneta_va_opened");
  return va!;
}

// Opened automatically once BVN and NIN are verified (called by the KYC review and when
// the app asks for the account), from the encrypted BVN kept since submission. Quiet
// no-op when not eligible, already open, or an attempt is running. A failed attempt
// keeps its lease, so the next automatic try waits for it to end (OPEN_LEASE_SECONDS).
export async function issueAccountWhenReady(userId: string) {
  const user = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!user || user.kycTier < 2) return;
  const wallet = await getOrCreateWallet(user.id);
  if (await findActiveVirtualAccount(wallet.id)) return;
  const p = await getKycProfile(user.id);
  if (!p?.bvnSealed) return;
  let bvn: string;
  try {
    bvn = unseal(p.bvnSealed);
  } catch {
    logger.error({ userId }, "va_auto_open_unseal_failed");
    return;
  }
  if (!(await matchesVerifiedBvn(user.id, bvn))) {
    logger.error({ userId }, "va_auto_open_bvn_mismatch");
    return;
  }
  if (!(await claimOpening(user.id))) return;
  try {
    if (!(await findActiveVirtualAccount(wallet.id))) await createAndStore(user, wallet.id, bvn);
    await releaseOpening(user.id).catch(() => undefined);
  } catch (err) {
    logger.warn({ userId, err: (err as Error).message }, "va_auto_open_attempt_failed");
  }
}

// Where the customer is on the way to an account number, for the apps:
// null (they have one) | "verify" (BVN + NIN not both verified) | "opening" (being opened
// automatically) | "needs_details" (verified before Wymlink kept the BVN: re-enter it once).
export async function accountSetupState(userId: string): Promise<"verify" | "opening" | "needs_details" | null> {
  const user = (await db.select({ tier: users.kycTier }).from(users).where(eq(users.id, userId)).limit(1))[0];
  if (await getMyVirtualAccount(userId)) return null;
  if (!user || user.tier < 2) return "verify";
  const p = await getKycProfile(userId);
  if (!p?.bvnSealed) return "needs_details";
  void issueAccountWhenReady(userId).catch(() => undefined);
  return "opening";
}

// Manual opening, for customers verified before the BVN was kept: they re-enter BVN and
// NIN, which must match the verified ones.
export async function openVirtualAccount(input: { userId: string; bvn: string; nin: string }) {
  const user = (await db.select().from(users).where(eq(users.id, input.userId)).limit(1))[0];
  if (!user) throw new NotFoundError("User not found");
  const wallet = await getOrCreateWallet(user.id);
  const existing = await findActiveVirtualAccount(wallet.id);
  if (existing) return existing;

  if (!(await matchesVerifiedIdentity(user.id, input.bvn, input.nin))) {
    throw new ValidationError(
      user.kycTier < 2
        ? "Verify your BVN and NIN first. Your account number is opened as soon as both are approved."
        : "That BVN or NIN doesn't match the ones verified on your account.",
    );
  }

  // One opening at a time per customer (Moneta allows one account per BVN).
  if (!(await claimOpening(user.id))) {
    throw new ValidationError("Your account number is already being set up. Check again in a minute.");
  }
  try {
    const again = await findActiveVirtualAccount(wallet.id);
    if (again) return again;
    return await createAndStore(user, wallet.id, input.bvn);
  } finally {
    await releaseOpening(user.id).catch(() => undefined);
  }
}

// The per-customer opening lock is a short lease row in app.provider_tokens (the same
// claim pattern as the shared Moneta token), not a database transaction: the Moneta call
// can take a minute, and holding a pooled connection that long — while the token lookup
// needs a second one — let a handful of simultaneous openings exhaust the pool.
// The lease outlives the slowest Moneta call, so a crashed request frees it by itself.
const OPEN_LEASE_SECONDS = 300;
const openingKey = (userId: string) => `va-open:${userId}`;

async function claimOpening(userId: string) {
  const res = await db.execute(sql`
    insert into app.provider_tokens (provider, token, lock_until)
    values (${openingKey(userId)}, '', now() + make_interval(secs => ${OPEN_LEASE_SECONDS}))
    on conflict (provider) do update set lock_until = excluded.lock_until
      where app.provider_tokens.lock_until is null or app.provider_tokens.lock_until < now()
    returning provider`);
  return res.rows.length === 1;
}

async function releaseOpening(userId: string) {
  await db.execute(sql`delete from app.provider_tokens where provider = ${openingKey(userId)}`);
}

// Records one Moneta credit and credits the wallet with the settled amount, in one
// transaction. A credit is recorded once (unique Moneta reference). A credit that would
// take the wallet over its tier's balance limit is held for staff review instead.
async function recordCredit(va: VirtualAccount, c: MonetaCredit) {
  return db.transaction(async (tx) => {
    const [d] = await tx
      .insert(deposits)
      .values({
        userId: va.userId,
        walletId: va.walletId,
        virtualAccountId: va.id,
        provider: "moneta",
        providerReference: c.reference,
        amount: centsToMoneyString(naira(c.amountSettled)),
        fee: centsToMoneyString(naira(Math.max(0, c.fee))),
        senderName: c.senderName,
        raw: c.raw,
        status: "detected",
      })
      .onConflictDoNothing({ target: [deposits.provider, deposits.providerReference] })
      .returning();
    if (!d) return null; // already recorded

    // Lock the wallet so the balance-limit check and the credit agree.
    await tx.execute(sql`select 1 from app.wallets where id = ${va.walletId}::uuid for update`);
    const [cap] = await tx
      .select({ balance: wallets.availableBalance, max: tierLimits.balanceMax })
      .from(wallets)
      .innerJoin(users, eq(users.id, wallets.userId))
      .innerJoin(tierLimits, eq(tierLimits.tier, users.kycTier))
      .where(eq(wallets.id, va.walletId));
    const amount = parseMoneyToCents(d.amount);
    if (cap?.max !== null && cap?.max !== undefined && parseMoneyToCents(cap.balance) + amount > parseMoneyToCents(cap.max)) {
      const [held] = await tx.update(deposits).set({ status: "held_for_review" }).where(eq(deposits.id, d.id)).returning();
      logger.warn({ depositId: d.id }, "deposit_held_over_balance_limit");
      return held!;
    }
    return creditDeposit(tx, d);
  });
}

async function creditDeposit(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], d: Deposit) {
  const entry = await postEntry(tx, {
    walletId: d.walletId,
    direction: "credit",
    amountCents: parseMoneyToCents(d.amount),
    entryType: "deposit",
    reference: `deposit:moneta:${d.providerReference}`,
    description: d.senderName ? `Deposit from ${d.senderName}` : "Deposit by bank transfer",
    relatedType: "deposit",
    relatedId: d.id,
  });
  const [credited] = await tx
    .update(deposits)
    .set({ status: "credited", ledgerEntryId: entry.id, creditedAt: new Date() })
    .where(eq(deposits.id, d.id))
    .returning();
  logger.info({ depositId: d.id }, "deposit_credited");
  return credited!;
}

// Reads the VA's Moneta history and records any new credits. Called only when a payment
// notification arrives (every Moneta call spends the proxy's monthly request quota).
// Only Moneta's own history is trusted.
export async function syncDeposits(va: VirtualAccount) {
  const from = new Date(Math.max(va.createdAt.getTime() - 86_400_000, Date.now() - 30 * 86_400_000));
  const credits = await listCredits(va.providerReference, from, new Date(Date.now() + 86_400_000));
  const fresh: Deposit[] = [];
  for (const c of credits) {
    const d = await recordCredit(va, c);
    if (d) fresh.push(d);
  }
  return fresh;
}

export async function listMyDeposits(userId: string, limit: number) {
  const rows = await db.select().from(deposits).where(eq(deposits.userId, userId)).orderBy(desc(deposits.detectedAt)).limit(limit);
  return rows.map(toDepositDto);
}

// Finds the VA a Moneta notification is about (by reference or account number).
export async function findVirtualAccountByProviderRef(ref: string | null, accountNumber: string | null) {
  if (ref) {
    const rows = await db.select().from(virtualAccounts).where(and(eq(virtualAccounts.provider, "moneta"), eq(virtualAccounts.providerReference, ref))).limit(1);
    if (rows[0]) return rows[0];
  }
  if (accountNumber && /^\d{10}$/.test(accountNumber)) {
    const rows = await db.select().from(virtualAccounts).where(eq(virtualAccounts.accountNumber, accountNumber)).limit(1);
    if (rows[0]) return rows[0];
  }
  return null;
}

// Staff: release a deposit held over the balance limit (credits it) after review.
export async function releaseHeldDeposit(depositId: string) {
  return db.transaction(async (tx) => {
    const [d] = await tx.select().from(deposits).where(eq(deposits.id, depositId)).for("update");
    if (!d) throw new NotFoundError("Deposit not found");
    if (d.status !== "held_for_review") throw new ValidationError(`This deposit is ${d.status}`);
    return creditDeposit(tx, d);
  });
}
