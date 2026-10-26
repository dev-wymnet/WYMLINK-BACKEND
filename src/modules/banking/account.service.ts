import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../../core/db/client.js";
import { deposits, tierLimits, users, virtualAccounts, wallets } from "../../core/db/schema.js";
import { NotFoundError } from "../../core/errors/NotFoundError.js";
import { ValidationError } from "../../core/errors/ValidationError.js";
import { logger } from "../../core/logger/logger.js";
import { centsToMoneyString, parseMoneyToCents } from "../../core/utils/money.js";
import { matchesVerifiedIdentity } from "../verification/service/verification.service.js";
import { findActiveVirtualAccount, getOrCreateWallet, postEntry } from "../wallet/repository/wallet.repository.js";
import { createVirtualAccount, getVirtualAccountBalance, listCredits, type MonetaCredit } from "../moneta/moneta.partner.js";

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

// Opens the customer's Moneta account. Moneta needs the BVN in plain digits; Wymlink
// never stores it, so the customer re-enters BVN and NIN and both must match the numbers
// staff verified. The BVN is sent to Moneta once and not kept (Moneta takes a NIN
// placeholder, see createVirtualAccount).
export async function openVirtualAccount(input: { userId: string; bvn: string; nin: string }) {
  const user = (await db.select().from(users).where(eq(users.id, input.userId)).limit(1))[0];
  if (!user) throw new NotFoundError("User not found");
  const wallet = await getOrCreateWallet(user.id);
  const existing = await findActiveVirtualAccount(wallet.id);
  if (existing) return existing;

  if (!(await matchesVerifiedIdentity(user.id, input.bvn, input.nin))) {
    throw new ValidationError(
      user.kycTier < 2
        ? "Verify your BVN and NIN first. You can get your account number once both are approved."
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

    const created = await createVirtualAccount({ firstName: user.firstName, surname: user.lastName, bvn: input.bvn });
    if (!created.ok) {
      logger.warn({ userId: user.id, message: created.message }, "moneta_va_create_failed");
      throw new ValidationError(`We couldn't open your account: ${created.message}`);
    }
    const [va] = await db
      .insert(virtualAccounts)
      .values({
        userId: user.id,
        walletId: wallet.id,
        provider: "moneta",
        providerReference: created.reference,
        accountNumber: created.accountNumber,
        accountName: created.accountName || `${user.firstName} ${user.lastName}`,
        bankName: created.bankName || "Providus Bank",
        raw: created.raw,
      })
      .returning();
    logger.info({ userId: user.id }, "moneta_va_opened");
    return va!;
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

// Reads the VA's Moneta history and records any new credits. Called when a payment
// notification arrives and when the account's Moneta balance changes (on demand, to
// stay inside the proxy's request quota). Only Moneta's own history is trusted.
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

// Deposits arrive on their own: whenever the wallet is read, Moneta's balance for the
// customer's account is checked (at most once a minute per account, to stay inside the
// proxy's request quota), and only when it has changed is the history read and any new
// credits recorded. The first check after a restart always reads the history.
const BALANCE_CHECK_MS = 60_000;
const lastCheck = new Map<string, { at: number; balance: number | null; running: Promise<void> | null }>();

export function refreshDepositsFromMoneta(va: VirtualAccount): Promise<void> {
  const prev = lastCheck.get(va.id);
  if (prev?.running) return prev.running;
  if (prev && Date.now() - prev.at < BALANCE_CHECK_MS) return Promise.resolve();

  const state = { at: Date.now(), balance: prev?.balance ?? null, running: null as Promise<void> | null };
  state.running = (async () => {
    const balance = await getVirtualAccountBalance(va.providerReference);
    if (balance === null || balance === state.balance) return;
    const fresh = await syncDeposits(va);
    state.balance = balance; // only once recorded, so a failed sync is retried next time
    if (fresh.length) logger.info({ virtualAccountId: va.id, credited: fresh.length }, "moneta_deposits_found");
  })()
    .catch((err) => logger.warn({ virtualAccountId: va.id, err: (err as Error).message }, "moneta_balance_check_failed"))
    .finally(() => {
      state.running = null;
    });
  lastCheck.set(va.id, state);
  return state.running;
}

// Moneta can take ~20 s to answer: wait this long for new deposits, then answer with
// what is recorded (the check carries on and the next read shows the rest).
const DEPOSIT_WAIT_MS = 8_000;

export async function waitForNewDeposits(va: VirtualAccount) {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([refreshDepositsFromMoneta(va), new Promise<void>((resolve) => (timer = setTimeout(resolve, DEPOSIT_WAIT_MS)))]);
  clearTimeout(timer);
}

export async function listMyDeposits(userId: string, limit: number) {
  const va = await getMyVirtualAccount(userId);
  if (va) await waitForNewDeposits(va);
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
