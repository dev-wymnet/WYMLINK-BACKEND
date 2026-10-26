import { and, asc, desc, eq, gte, lte, or, sql, type SQL } from "drizzle-orm";

import { db } from "../../../../core/db/client.js";
import { kycProfiles, users, walletLedger, wallets } from "../../../../core/db/schema.js";
import type { Executor } from "../../../wallet/repository/wallet.repository.js";

export type ListCustomersInput = {
  page: number;
  limit: number;
  search?: string | undefined;
  // review = a BVN/NIN waiting for a staff decision; none = nothing submitted.
  kycStatus?: "verified" | "failed" | "pending" | "review" | "none" | undefined;
  status?: "active" | "disabled" | undefined;
  country?: string | undefined;
  currency?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  sort: "joinedAt" | "name";
  order: "asc" | "desc";
};

function buildCustomerWhere(input: ListCustomersInput) {
  const conditions: SQL[] = [eq(users.role, "customer")];

  if (input.search) {
    const term = `%${input.search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conditions.push(
      or(
        sql`${users.firstName} ilike ${term}`,
        sql`${users.lastName} ilike ${term}`,
        sql`(${users.firstName} || ' ' || ${users.lastName}) ilike ${term}`,
        sql`${users.email}::text ilike ${term}`,
        sql`${users.phone} ilike ${term}`,
      )!,
    );
  }
  if (input.status) conditions.push(eq(users.status, input.status));
  if (input.from) conditions.push(gte(users.createdAt, input.from));
  if (input.to) conditions.push(lte(users.createdAt, input.to));

  if (input.kycStatus) {
    // Customers who never started KYC have no profile row.
    const bvn = sql`coalesce(${kycProfiles.bvnStatus}, 'none')`;
    const nin = sql`coalesce(${kycProfiles.ninStatus}, 'none')`;
    const any = (s: string) => sql`(${bvn} = ${s} or ${nin} = ${s})`;
    if (input.kycStatus === "verified") conditions.push(any("verified"));
    else if (input.kycStatus === "failed") conditions.push(any("failed"));
    else if (input.kycStatus === "review" || input.kycStatus === "pending") conditions.push(any("pending"));
    else conditions.push(sql`${bvn} = 'none' and ${nin} = 'none'`);
  }

  return and(...conditions);
}

export async function listCustomers(input: ListCustomersInput) {
  const limit = Math.min(Math.max(input.limit, 1), 200);
  const offset = (Math.max(input.page, 1) - 1) * limit;
  const dir = input.order === "asc" ? asc : desc;
  const orderBy = input.sort === "name" ? [dir(users.firstName), dir(users.lastName)] : [dir(users.createdAt)];

  return db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      phone: users.phone,
      status: users.status,
      kycTier: users.kycTier,
      createdAt: users.createdAt,
      bvnStatus: kycProfiles.bvnStatus,
      ninStatus: kycProfiles.ninStatus,
    })
    .from(users)
    .leftJoin(kycProfiles, eq(kycProfiles.userId, users.id))
    .where(buildCustomerWhere(input))
    .orderBy(...orderBy)
    .limit(limit)
    .offset(offset);
}

export async function countCustomers(input: ListCustomersInput) {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(users)
    .leftJoin(kycProfiles, eq(kycProfiles.userId, users.id))
    .where(buildCustomerWhere(input));
  return row?.c ?? 0;
}

export async function getCustomerWithKyc(customerId: string, ex: Executor = db) {
  const [row] = await ex
    .select({ user: users, kyc: kycProfiles })
    .from(users)
    .leftJoin(kycProfiles, eq(kycProfiles.userId, users.id))
    .where(eq(users.id, customerId))
    .limit(1);
  return row ?? null;
}

export async function getCustomerWallet(customerId: string) {
  const rows = await db.select().from(wallets).where(eq(wallets.userId, customerId)).limit(1);
  return rows[0] ?? null;
}

export type ListCustomerTransactionsInput = {
  customerId: string;
  from?: Date | undefined;
  to?: Date | undefined;
  type?: string | undefined;
  direction?: "credit" | "debit" | undefined;
  minAmount?: string | undefined;
  maxAmount?: string | undefined;
  page: number;
  limit: number;
  sort: "date" | "amount";
  order: "asc" | "desc";
};

function buildLedgerWhere(input: ListCustomerTransactionsInput) {
  const conditions: SQL[] = [eq(walletLedger.userId, input.customerId)];
  if (input.from) conditions.push(gte(walletLedger.createdAt, input.from));
  if (input.to) conditions.push(lte(walletLedger.createdAt, input.to));
  if (input.type) conditions.push(eq(walletLedger.entryType, input.type));
  if (input.direction) conditions.push(eq(walletLedger.direction, input.direction));
  if (input.minAmount) conditions.push(sql`${walletLedger.amount} >= ${input.minAmount}::numeric`);
  if (input.maxAmount) conditions.push(sql`${walletLedger.amount} <= ${input.maxAmount}::numeric`);
  return and(...conditions);
}

export async function listCustomerLedger(input: ListCustomerTransactionsInput) {
  const limit = Math.min(Math.max(input.limit, 1), 200);
  const offset = (Math.max(input.page, 1) - 1) * limit;
  const dir = input.order === "asc" ? asc : desc;
  return db
    .select()
    .from(walletLedger)
    .where(buildLedgerWhere(input))
    .orderBy(input.sort === "amount" ? dir(walletLedger.amount) : dir(walletLedger.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function countCustomerLedger(input: ListCustomerTransactionsInput) {
  const [row] = await db.select({ c: sql<number>`count(*)::int` }).from(walletLedger).where(buildLedgerWhere(input));
  return row?.c ?? 0;
}

export async function setCustomerStatus(ex: Executor, userId: string, status: "active" | "disabled") {
  await ex.update(users).set({ status }).where(eq(users.id, userId));
}
