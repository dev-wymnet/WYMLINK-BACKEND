import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../../core/db/client.js";
import { deposits, kycProfiles, tierLimits, users, virtualAccounts, wallets } from "../../core/db/schema.js";
import { NotFoundError } from "../../core/errors/NotFoundError.js";
import { ValidationError } from "../../core/errors/ValidationError.js";
import { logger } from "../../core/logger/logger.js";
import { centsToMoneyString, parseMoneyToCents } from "../../core/utils/money.js";
import { unseal } from "../../core/utils/seal.js";
import { getKycProfile } from "../verification/repository/verification.repository.js";
import { matchesVerifiedBvn } from "../verification/service/verification.service.js";
import { findActiveVirtualAccount, getOrCreateWallet, postEntry } from "../wallet/repository/wallet.repository.js";
import { createVirtualAccount, listCredits, type MonetaCredit } from "../moneta/moneta.partner.js";

export type VirtualAccount = typeof virtualAccounts.$inferSelect;
export type Deposit = typeof deposits.$inferSelect;

const naira = (n: number) => parseMoneyToCents(n.toFixed(2));

type Owner = { firstName: string; lastName: string } | null | undefined;

// What a customer sees as their account's name: Moneta's name (which holds only the
// customer ID: Moneta allows 8 characters) with their own name after the ID, e.g.
// "MONETA TECH(WYMNET-WL417731 ADA LOVELACE)". Display only: banks still show Moneta's name.
export function displayAccountName(raw: string, owner: Owner) {
  const words = owner ? `${owner.firstName} ${owner.lastName}`.toUpperCase().split(/\s+/).filter(Boolean) : [];
  // Older accounts were named after the first name: add only what isn't there yet.
  const missing = words.filter((w) => !raw.toUpperCase().includes(w)).join(" ");
  if (!missing) return raw;
  return raw.endsWith(")") ? `${raw.slice(0, -1)} ${missing})` : `${raw} ${missing}`.trim();
}

export async function accountOwner(userId: string): Promise<Owner> {
  const [u] = await db.select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, userId)).limit(1);
  return u ?? null;
}

export function toVirtualAccountDto(va: VirtualAccount, owner?: Owner) {
  return { accountNumber: va.accountNumber, accountName: displayAccountName(va.accountName, owner), bankName: va.bankName, status: va.status, createdAt: va.createdAt };
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

// ---------- Customer ID ----------

const newCustomerCode = () => `WL${String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0")}`;

// The customer's short unique ID ("WL" + 6 digits), created on first need. Also the name of
// their Moneta account, so an account number seen at Moneta traces back to its owner.
export async function ensureCustomerCode(userId: string): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const [u] = await db.select({ code: users.customerCode }).from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw new NotFoundError("User not found");
    if (u.code) return u.code;
    try {
      const [set] = await db
        .update(users)
        .set({ customerCode: newCustomerCode() })
        .where(and(eq(users.id, userId), sql`${users.customerCode} is null`))
        .returning({ code: users.customerCode });
      if (set?.code) return set.code;
    } catch (err: any) {
      if ((err?.code ?? err?.cause?.code) !== "23505") throw err; // taken: try another
    }
  }
  throw new Error("Couldn't create a customer ID");
}

// ---------- Account numbers ----------

// Opens the Moneta account, named with the customer ID. No BVN or NIN is needed: a verified
// BVN kept from KYC is used when there is one, otherwise Moneta's placeholder.
async function createAndStore(user: typeof users.$inferSelect, walletId: string) {
  const code = user.customerCode ?? (await ensureCustomerCode(user.id));
  let bvn: string | null = null;
  const p = await getKycProfile(user.id).catch(() => null);
  if (p?.bvnSealed) {
    try {
      const b = unseal(p.bvnSealed);
      if (await matchesVerifiedBvn(user.id, b)) bvn = b;
    } catch {
      logger.error({ userId: user.id }, "va_open_unseal_failed");
    }
  }
  // A business's account carries its name (payers see it), a customer's their customer ID.
  const accountName = user.role === "business" ? user.firstName : code;
  const created = await createVirtualAccount({ firstName: user.firstName, surname: user.lastName, bvn, accountName });
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
  if (p?.bvnSealed) await db.update(kycProfiles).set({ bvnSealed: null }).where(eq(kycProfiles.userId, user.id));
  logger.info({ userId: user.id }, "moneta_va_opened");
  return va!;
}

// Opens the account number of any customer (or business) that has none: right after sign-up,
// and again whenever the apps ask for it. Quiet no-op when one exists or an attempt is
// running. A failed attempt keeps its lease, so the next automatic try waits for it to end
// (OPEN_LEASE_SECONDS): a Moneta outage costs at most one call per customer per 5 minutes.
export async function issueAccount(userId: string): Promise<VirtualAccount | null> {
  const user = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!user || (user.role !== "customer" && user.role !== "business") || user.status !== "active") return null;
  const wallet = await getOrCreateWallet(user.id);
  const existing = await findActiveVirtualAccount(wallet.id);
  if (existing) return existing;
  if (!(await claimOpening(user.id))) return null;
  try {
    const again = await findActiveVirtualAccount(wallet.id);
    const va = again ?? (await createAndStore(user, wallet.id));
    await releaseOpening(user.id).catch(() => undefined);
    return va;
  } catch (err) {
    logger.warn({ userId, err: (err as Error).message }, "va_open_attempt_failed");
    return null;
  }
}

// Staff "try again": drops a failed attempt's lease first.
export async function retryAccount(userId: string) {
  await releaseOpening(userId).catch(() => undefined);
  return issueAccount(userId);
}

// Kept for the KYC review, which used to open accounts on approval.
export const issueAccountWhenReady = (userId: string) => issueAccount(userId).then(() => undefined);

// Where the customer is on the way to an account number, for the apps: null (they have
// one) or "opening" (being opened now). Asking starts an opening when none is running.
export async function accountSetupState(userId: string): Promise<"opening" | null> {
  if (await getMyVirtualAccount(userId)) return null;
  void issueAccount(userId).catch(() => undefined);
  return "opening";
}

// The apps' "get my account number": opens it now (no BVN or NIN needed).
export async function openVirtualAccount(input: { userId: string }) {
  const user = (await db.select().from(users).where(eq(users.id, input.userId)).limit(1))[0];
  if (!user) throw new NotFoundError("User not found");
  const va = await issueAccount(user.id);
  if (va) return va;
  throw new ValidationError("Your account number is being set up. Check again in a minute.");
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

// Reads the VA's Moneta history and records any new credits. Called when a payment
// notification arrives and by checkForDeposits (every Moneta call spends the proxy's monthly
// request quota).
// Only Moneta's own history is trusted.
export async function syncDeposits(va: VirtualAccount) {
  const from = new Date(Math.max(va.createdAt.getTime() - 86_400_000, Date.now() - 30 * 86_400_000));
  const credits = await listCredits(va.providerReference, from, new Date(Date.now() + 86_400_000));
  logger.info({ userId: va.userId, seen: credits.length }, "moneta_history_read");
  const fresh: Deposit[] = [];
  for (const c of credits) {
    const d = await recordCredit(va, c);
    if (d) fresh.push(d);
  }
  return fresh;
}

// Moneta's payment notification credits deposits within seconds. As a fallback, a customer
// opening their deposits list also checks their account's Moneta history: at most once every
// 10 minutes per customer, since each check spends the proxy's monthly request quota (home
// and wallet screens no longer check: with every customer holding an account, that would
// spend it in hours). Waits briefly so a credit that has landed shows in the same response.
const DEPOSIT_CHECK_EVERY_MS = 10 * 60_000;
const DEPOSIT_CHECK_WAIT_MS = 6_000;
const lastDepositCheck = new Map<string, number>();

export async function checkForDeposits(userId: string) {
  const now = Date.now();
  if (now - (lastDepositCheck.get(userId) ?? 0) < DEPOSIT_CHECK_EVERY_MS) return;
  lastDepositCheck.set(userId, now);
  if (lastDepositCheck.size > 50_000) lastDepositCheck.clear();
  const va = await getMyVirtualAccount(userId);
  if (!va) return;
  const started = Date.now();
  const sync = syncDeposits(va)
    .then((fresh) => logger.info({ userId, credited: fresh.length, ms: Date.now() - started }, "deposit_check_done"))
    .catch((err) => logger.warn({ userId, err: (err as Error).message }, "deposit_check_failed"));
  await Promise.race([sync, new Promise((r) => setTimeout(r, DEPOSIT_CHECK_WAIT_MS))]);
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
