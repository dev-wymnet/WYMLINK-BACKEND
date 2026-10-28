import { randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";

import { env } from "../../../core/config/env.js";
import { db } from "../../../core/db/client.js";
import { collectionAccounts, collections, users, virtualAccounts } from "../../../core/db/schema.js";
import { NotFoundError } from "../../../core/errors/NotFoundError.js";
import { ValidationError } from "../../../core/errors/ValidationError.js";
import { logger } from "../../../core/logger/logger.js";
import { centsToMoneyString, parseMoneyToCents } from "../../../core/utils/money.js";
import { insertAuditLog } from "../../audit/repository/audit.repository.js";
import { findPayout, getVirtualAccountBalance, listBanks, payout, resolveAccount } from "../../moneta/moneta.partner.js";

// Collections move the money customers spent on purchases out of their Moneta accounts
// into WymNet's bank account (see db/migrations/0009_collections.sql).
//
//   owed = delivered provider purchases (paid from WymNet's Peyflex/Reloadly balance)
//          − collections already made or in flight
//
// A collection takes min(owed, the VA's real Moneta balance). Moneta's payout fee comes
// out of the VA on top of the amount sent, so WymNet sends (that − fee) and absorbs the
// fee: the VA then ends equal to the customer's wallet balance.

type Staff = { id: string; role?: string | undefined; ip?: string | undefined; userAgent?: string | undefined };
type Collection = typeof collections.$inferSelect;

const naira = (n: number) => parseMoneyToCents(n.toFixed(2));
const MIN_SENT = parseMoneyToCents("50.00");
const feeCents = () => parseMoneyToCents(env.MONETA_PAYOUT_FEE.toFixed(2));

const audit = (staff: Staff, action: string, targetType: string, targetId: string, after: unknown) =>
  insertAuditLog({
    actorUserId: staff.id,
    actorRole: staff.role ?? null,
    action,
    targetType,
    targetId,
    success: true,
    after: after as any,
    ip: staff.ip ?? null,
    userAgent: staff.userAgent ?? null,
  });

// ---------- Where collections are paid ----------

export async function getCollectionAccount() {
  const rows = await db.select().from(collectionAccounts).where(eq(collectionAccounts.active, true)).limit(1);
  return rows[0] ?? null;
}

// The name always comes from Moneta's name enquiry, never from what staff typed.
export async function setCollectionAccount(input: { bankCode: string; accountNumber: string; staff: Staff }) {
  const bank = (await listBanks()).find((b) => b.code === input.bankCode);
  if (!bank) throw new ValidationError("Choose the bank from the list");
  const accountName = await resolveAccount(bank.code, input.accountNumber);
  if (!accountName) throw new ValidationError("We couldn't find that account. Check the number and bank.");
  const created = await db.transaction(async (tx) => {
    await tx.update(collectionAccounts).set({ active: false }).where(eq(collectionAccounts.active, true));
    const [row] = await tx
      .insert(collectionAccounts)
      .values({ bankCode: bank.code, bankName: bank.name, accountNumber: input.accountNumber, accountName, setBy: input.staff.id })
      .returning();
    return row!;
  });
  await audit(input.staff, "COLLECTION_ACCOUNT_SET", "collection_account", created.id, {
    bankName: created.bankName,
    accountNumber: created.accountNumber,
    accountName: created.accountName,
  });
  return created;
}

// ---------- Who owes what ----------

export type OwedRow = {
  userId: string;
  name: string;
  email: string | null;
  phone: string | null;
  accountNumber: string;
  virtualAccountId: string;
  virtualAccountReference: string;
  spent: string;
  collected: string;
  inFlight: string;
  owed: string;
  lastCollectedAt: Date | null;
};

async function owedRows(userId?: string): Promise<OwedRow[]> {
  const res = await db.execute(sql`
    select u.id as user_id, u.first_name, u.last_name, u.email::text as email, u.phone,
           va.id as va_id, va.account_number, va.provider_reference,
           coalesce(p.spent, 0)::text as spent,
           coalesce(c.collected, 0)::text as collected,
           coalesce(c.in_flight, 0)::text as in_flight,
           greatest(coalesce(p.spent, 0) - coalesce(c.collected, 0) - coalesce(c.in_flight, 0), 0)::text as owed,
           c.last_at
      from app.virtual_accounts va
      join app.users u on u.id = va.user_id
      left join (
        select user_id, sum(amount) as spent
          from app.vtu_orders
         where status = 'success' and provider in ('peyflex', 'reloadly')
         group by user_id
      ) p on p.user_id = u.id
      left join (
        select user_id,
               sum(gross) filter (where status = 'success') as collected,
               sum(gross) filter (where status in ('processing', 'unknown')) as in_flight,
               max(completed_at) filter (where status = 'success') as last_at
          from app.collections
         group by user_id
      ) c on c.user_id = u.id
     where va.status = 'active' and va.provider = 'moneta'
       ${userId ? sql`and u.id = ${userId}::uuid` : sql``}
     order by greatest(coalesce(p.spent, 0) - coalesce(c.collected, 0) - coalesce(c.in_flight, 0), 0) desc, u.created_at`);
  return (res.rows as any[]).map((r) => ({
    userId: r.user_id,
    name: `${r.first_name} ${r.last_name}`.trim(),
    email: r.email,
    phone: r.phone,
    accountNumber: r.account_number,
    virtualAccountId: r.va_id,
    virtualAccountReference: r.provider_reference,
    spent: Number(r.spent).toFixed(2),
    collected: Number(r.collected).toFixed(2),
    inFlight: Number(r.in_flight).toFixed(2),
    owed: Number(r.owed).toFixed(2),
    lastCollectedAt: r.last_at ? new Date(r.last_at) : null,
  }));
}

// With `withBalances`, each customer who owes something also gets their live Moneta
// balance and what a collection would take now (one Moneta call each: use sparingly).
export async function listOwed(input: { withBalances?: boolean | undefined } = {}) {
  const rows = await owedRows();
  const fee = feeCents();
  const out = [];
  for (const r of rows) {
    let vaBalance: string | null = null;
    let collectable: string | null = null;
    if (input.withBalances && parseMoneyToCents(r.owed) > 0n) {
      const bal = await getVirtualAccountBalance(r.virtualAccountReference).catch(() => null);
      if (bal !== null) {
        vaBalance = bal.toFixed(2);
        const gross = minCents(parseMoneyToCents(r.owed), naira(bal));
        collectable = gross - fee >= MIN_SENT ? centsToMoneyString(gross) : "0.00";
      }
    }
    const { virtualAccountReference: _ref, ...rest } = r;
    out.push({ ...rest, vaBalance, collectable });
  }
  const sum = (k: "spent" | "collected" | "inFlight" | "owed") => centsToMoneyString(rows.reduce((a, r) => a + parseMoneyToCents(r[k]), 0n));
  return {
    fee: centsToMoneyString(fee),
    totals: { spent: sum("spent"), collected: sum("collected"), inFlight: sum("inFlight"), owed: sum("owed") },
    customers: out,
  };
}

const minCents = (a: bigint, b: bigint) => (a < b ? a : b);

// ---------- Collecting ----------

export function toCollectionDto(c: Collection & { name?: string; accountNumber?: string }) {
  return {
    id: c.id,
    userId: c.userId,
    customer: c.name ?? null,
    accountNumber: c.accountNumber ?? null,
    owedBefore: c.owedBefore,
    vaBalanceBefore: c.vaBalanceBefore,
    gross: c.gross,
    fee: c.fee,
    sent: c.sent,
    status: c.status,
    providerReference: c.providerReference,
    lastError: c.lastError,
    createdAt: c.createdAt,
    completedAt: c.completedAt,
  };
}

// Collects from one customer. Never more than they owe, never more than their VA holds.
export async function collectFromCustomer(userId: string, staff: Staff) {
  const account = await getCollectionAccount();
  if (!account) throw new ValidationError("Set the bank account collections are paid to first.");
  const row = (await owedRows(userId))[0];
  if (!row) throw new NotFoundError("This customer has no account number yet.");
  const owed = parseMoneyToCents(row.owed);
  const fee = feeCents();
  if (owed - fee < MIN_SENT) {
    return { skipped: true as const, reason: `Owes ₦${row.owed}: too little to cover Moneta's ₦${centsToMoneyString(fee)} fee.` };
  }

  const balance = await getVirtualAccountBalance(row.virtualAccountReference);
  if (balance === null) throw new ValidationError("Couldn't read this customer's Moneta balance. Try again shortly.");
  const gross = minCents(owed, naira(balance));
  const sentCents = gross - fee;
  if (sentCents < MIN_SENT) {
    return { skipped: true as const, reason: `Moneta balance is ₦${balance.toFixed(2)}: not enough to collect after the fee.` };
  }

  const tag = `WYMCOL${randomBytes(6).toString("hex").toUpperCase().slice(0, 8)}`;
  let c: Collection;
  try {
    [c] = (await db
      .insert(collections)
      .values({
        userId: row.userId,
        virtualAccountId: row.virtualAccountId,
        collectionAccountId: account.id,
        owedBefore: row.owed,
        vaBalanceBefore: balance.toFixed(2),
        gross: centsToMoneyString(gross),
        fee: centsToMoneyString(fee),
        sent: centsToMoneyString(sentCents),
        narration: `${tag} Wymlink collection`,
        status: "processing",
        createdBy: staff.id,
      })
      .returning()) as [Collection];
  } catch (err: any) {
    if ((err?.code ?? err?.cause?.code) === "23505") throw new ValidationError("A collection for this customer is already in progress.");
    throw err;
  }

  const outcome = await payout({
    sourceReference: row.virtualAccountReference,
    bankId: account.bankCode,
    accountNumber: account.accountNumber,
    amount: Number(centsToMoneyString(sentCents)),
    narration: c.narration,
  }).catch((err) => ({ status: "failed" as const, providerReference: null, fee: null, message: (err as Error).message, raw: null }));

  const done = await applyOutcome(c, outcome.status, outcome.providerReference, outcome.fee, outcome.message);
  await audit(staff, "COLLECTION_RUN", "collection", c.id, { userId: row.userId, sent: done.sent, fee: done.fee, status: done.status });
  return { skipped: false as const, collection: toCollectionDto({ ...done, name: row.name, accountNumber: row.accountNumber }) };
}

async function applyOutcome(c: Collection, status: "success" | "failed" | "unknown", providerReference: string | null, actualFee: number | null, message: string | null) {
  const set: Partial<typeof collections.$inferInsert> = { status, providerReference: providerReference ?? c.providerReference, lastError: status === "success" ? null : message };
  if (status !== "unknown") set.completedAt = new Date();
  // Record what actually left the VA: sent + the fee Moneta reports.
  if (status === "success" && actualFee !== null) {
    const fee = naira(actualFee);
    set.fee = centsToMoneyString(fee);
    set.gross = centsToMoneyString(parseMoneyToCents(c.sent) + fee);
  }
  const [done] = await db
    .update(collections)
    .set(set)
    .where(and(eq(collections.id, c.id), sql`${collections.status} in ('processing', 'unknown')`))
    .returning();
  logger.info({ collectionId: c.id, status }, "collection_outcome");
  return done ?? c;
}

// Collects from everyone who owes enough. One customer at a time (each is a Moneta payout).
export async function collectFromAll(staff: Staff) {
  const fee = feeCents();
  const due = (await owedRows()).filter((r) => parseMoneyToCents(r.owed) - fee >= MIN_SENT);
  const results = [];
  for (const r of due) {
    try {
      results.push({ userId: r.userId, name: r.name, ...(await collectFromCustomer(r.userId, staff)) });
    } catch (err) {
      results.push({ userId: r.userId, name: r.name, skipped: true, reason: (err as Error).message });
    }
  }
  return { attempted: due.length, results };
}

export async function listCollections(limit: number) {
  const rows = await db
    .select({ c: collections, first: users.firstName, last: users.lastName, acct: virtualAccounts.accountNumber })
    .from(collections)
    .innerJoin(users, eq(users.id, collections.userId))
    .innerJoin(virtualAccounts, eq(virtualAccounts.id, collections.virtualAccountId))
    .orderBy(desc(collections.createdAt))
    .limit(limit);
  return rows.map((r) => toCollectionDto({ ...r.c, name: `${r.first} ${r.last}`.trim(), accountNumber: r.acct }));
}

// An unconfirmed collection is looked up in Moneta's payout history by its tag.
export async function refreshCollection(id: string, staff: Staff) {
  const [c] = await db.select().from(collections).where(eq(collections.id, id)).limit(1);
  if (!c) throw new NotFoundError("Collection not found");
  if (c.status !== "unknown" && c.status !== "processing") return toCollectionDto(c);
  const hit = await findPayout({ narrationTag: c.narration.split(" ")[0]!, since: c.createdAt });
  if (!hit || !hit.found || hit.status === "unknown") return toCollectionDto(c);
  const done = await applyOutcome(c, hit.status, hit.providerReference, null, hit.status === "failed" ? "Declined by the bank" : null);
  await audit(staff, "COLLECTION_CONFIRMED", "collection", c.id, { status: done.status });
  return toCollectionDto(done);
}
