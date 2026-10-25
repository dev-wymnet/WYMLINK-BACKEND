import { and, asc, desc, eq, gte, lte, or, sql } from "drizzle-orm";

import { db } from "../../../../core/db/client.js";
import {
  users,
  userVerifications,
  walletLedger,
  wallets,
} from "../../../../core/db/schema.js";

export type ListCustomersInput = {
  page: number;
  limit: number;
  search?: string | undefined;
  kycStatus?: "verified" | "failed" | "pending" | "review" | undefined;
  status?: "active" | "disabled" | undefined;
  country?: string | undefined;
  currency?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  sort: "joinedAt" | "name";
  order: "asc" | "desc";
};

function buildCustomerWhere(input: ListCustomersInput) {
  const conditions: any[] = [sql`${users.role} = 'customer'`];

  if (input.search) {
    const term = `%${input.search}%`;
    conditions.push(
      or(
        sql`${users.firstName} ILIKE ${term}`,
        sql`${users.lastName} ILIKE ${term}`,
        sql`${users.email} ILIKE ${term}`,
        sql`${users.phone} ILIKE ${term}`,
      ),
    );
  }

  if (input.status) conditions.push(eq(users.status, input.status));
  if (input.country) conditions.push(eq(users.countryCode, input.country));
  if (input.currency) conditions.push(eq(users.currencyCode, input.currency));
  if (input.from) conditions.push(gte(users.createdAt, input.from));
  if (input.to) conditions.push(lte(users.createdAt, input.to));

  if (input.kycStatus) {
    // Customers who never started KYC have no verification row, so statuses can be NULL.
    const bvn = sql`coalesce(${userVerifications.bvnStatus}, 'PENDING')`;
    const nin = sql`coalesce(${userVerifications.ninStatus}, 'PENDING')`;
    const anyVerified = sql`(${bvn} = 'VERIFIED' or ${nin} = 'VERIFIED')`;
    if (input.kycStatus === "verified") {
      conditions.push(anyVerified);
    } else if (input.kycStatus === "failed") {
      conditions.push(sql`(${bvn} = 'FAILED' or ${nin} = 'FAILED')`);
    } else if (input.kycStatus === "review") {
      // A check failed and nothing is verified yet: needs a human decision.
      conditions.push(sql`(${bvn} = 'FAILED' or ${nin} = 'FAILED') and not ${anyVerified}`);
    } else {
      conditions.push(sql`${bvn} = 'PENDING' and ${nin} = 'PENDING'`);
    }
  }

  return and(...conditions);
}

export async function listCustomers(input: ListCustomersInput) {
  const limit = Math.min(Math.max(input.limit, 1), 200);
  const offset = (Math.max(input.page, 1) - 1) * limit;

  const where = buildCustomerWhere(input);

  const orderBy =
    input.sort === "name"
      ? [
          input.order === "asc" ? asc(users.firstName) : desc(users.firstName),
          input.order === "asc" ? asc(users.lastName) : desc(users.lastName),
        ]
      : [input.order === "asc" ? asc(users.createdAt) : desc(users.createdAt)];

  return db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      phone: users.phone,
      countryCode: users.countryCode,
      currencyCode: users.currencyCode,
      status: users.status,
      createdAt: users.createdAt,
      bvnStatus: userVerifications.bvnStatus,
      ninStatus: userVerifications.ninStatus,
    })
    .from(users)
    .leftJoin(userVerifications, eq(userVerifications.userId, users.id))
    .where(where)
    .orderBy(...orderBy)
    .limit(limit)
    .offset(offset);
}

export async function countCustomers(input: ListCustomersInput) {
  const where = buildCustomerWhere(input);
  const [row] = await db
    .select({
      c: sql<number>`count(distinct ${users.id})::int`,
    })
    .from(users)
    .leftJoin(userVerifications, eq(userVerifications.userId, users.id))
    .where(where);
  return row?.c ?? 0;
}

export async function getCustomerWithKyc(customerId: string) {
  const [row] = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      phone: users.phone,
      countryCode: users.countryCode,
      currencyCode: users.currencyCode,
      preferredCurrency: users.preferredCurrency,
      region: users.region,
      complianceRegion: users.complianceRegion,
      dataLocalizationRegion: users.dataLocalizationRegion,
      complianceTier: users.complianceTier,
      role: users.role,
      status: users.status,
      telecomReloadlyEnabled: users.telecomReloadlyEnabled,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      bvn: userVerifications.bvn,
      bvnSuffix: userVerifications.bvnSuffix,
      bvnStatus: userVerifications.bvnStatus,
      bvnVerifiedAt: userVerifications.bvnVerifiedAt,
      bvnProviderReference: userVerifications.bvnProviderReference,
      bvnFailureReason: userVerifications.bvnFailureReason,
      nin: userVerifications.nin,
      ninSuffix: userVerifications.ninSuffix,
      ninStatus: userVerifications.ninStatus,
      ninVerifiedAt: userVerifications.ninVerifiedAt,
      ninProviderReference: userVerifications.ninProviderReference,
      ninFailureReason: userVerifications.ninFailureReason,
    })
    .from(users)
    .leftJoin(userVerifications, eq(userVerifications.userId, users.id))
    .where(eq(users.id, customerId))
    .limit(1);
  return row ?? null;
}

export async function getCustomerWallets(customerId: string) {
  return db
    .select({
      id: wallets.id,
      currencyCode: wallets.currencyCode,
      availableBalance: wallets.availableBalance,
      lockedBalance: wallets.lockedBalance,
      status: wallets.status,
      createdAt: wallets.createdAt,
    })
    .from(wallets)
    .where(eq(wallets.userId, customerId))
    .orderBy(asc(wallets.currencyCode));
}

export type ListCustomerTransactionsInput = {
  customerId: string;
  from?: Date | undefined;
  to?: Date | undefined;
  type?: string | undefined;
  status?: string | undefined;
  currency?: string | undefined;
  minAmount?: string | undefined;
  maxAmount?: string | undefined;
  page: number;
  limit: number;
  sort: "date" | "amount";
  order: "asc" | "desc";
};

function buildLedgerWhere(input: ListCustomerTransactionsInput) {
  const conditions: any[] = [eq(walletLedger.userId, input.customerId)];

  if (input.from) conditions.push(gte(walletLedger.createdAt, input.from));
  if (input.to) conditions.push(lte(walletLedger.createdAt, input.to));
  if (input.type) conditions.push(eq(walletLedger.transactionType, input.type));
  if (input.status) conditions.push(eq(walletLedger.status, input.status));
  if (input.currency)
    conditions.push(eq(walletLedger.currencyCode, input.currency));
  if (input.minAmount) {
    conditions.push(
      sql`${walletLedger.amount}::numeric >= ${input.minAmount}::numeric`,
    );
  }
  if (input.maxAmount) {
    conditions.push(
      sql`${walletLedger.amount}::numeric <= ${input.maxAmount}::numeric`,
    );
  }

  return and(...conditions);
}

export async function listCustomerLedger(input: ListCustomerTransactionsInput) {
  const limit = Math.min(Math.max(input.limit, 1), 200);
  const offset = (Math.max(input.page, 1) - 1) * limit;

  const where = buildLedgerWhere(input);

  const orderBy =
    input.sort === "amount"
      ? [
          input.order === "asc"
            ? asc(sql`${walletLedger.amount}::numeric`)
            : desc(sql`${walletLedger.amount}::numeric`),
        ]
      : [
          input.order === "asc"
            ? asc(walletLedger.createdAt)
            : desc(walletLedger.createdAt),
        ];

  return db
    .select({
      id: walletLedger.id,
      walletId: walletLedger.walletId,
      transactionType: walletLedger.transactionType,
      direction: walletLedger.direction,
      amount: walletLedger.amount,
      currencyCode: walletLedger.currencyCode,
      balanceBefore: walletLedger.balanceBefore,
      balanceAfter: walletLedger.balanceAfter,
      referenceCode: walletLedger.referenceCode,
      relatedOrderId: walletLedger.relatedOrderId,
      description: walletLedger.description,
      status: walletLedger.status,
      createdAt: walletLedger.createdAt,
    })
    .from(walletLedger)
    .where(where)
    .orderBy(...orderBy)
    .limit(limit)
    .offset(offset);
}

export async function countCustomerLedger(
  input: ListCustomerTransactionsInput,
) {
  const where = buildLedgerWhere(input);
  const [row] = await db
    .select({
      c: sql<number>`count(*)::int`,
    })
    .from(walletLedger)
    .where(where);
  return row?.c ?? 0;
}

export async function setCustomerStatusTx(
  tx: any,
  userId: string,
  status: string,
) {
  return tx.update(users).set({ status }).where(eq(users.id, userId));
}
