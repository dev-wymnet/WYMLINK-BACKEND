import { and, asc, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";

import { db } from "../../../../core/db/client.js";
import { telecomTransactions, users, wallets } from "../../../../core/db/schema.js";

export type AdminBillRow = {
  id: string;
  internalReference: string;
  userId: string;
  customerName: string | null;
  type: string;
  amount: string;
  currency: string;
  status: string;
  provider: string | null;
  providerReference: string | null;
  date: Date;
};

export async function listBills(input: {
  from?: Date | undefined;
  to?: Date | undefined;
  customerId?: string | undefined;
  search?: string | undefined;
  country?: string | undefined;
  currency?: string | undefined;
  status?: string | undefined;
  type?: "airtime" | "data" | undefined;
  provider?: string | undefined;
  limit: number;
  offset: number;
  sort: "date" | "amount";
  order: "asc" | "desc";
}): Promise<AdminBillRow[]> {
  const conditions: any[] = [];
  if (input.from) conditions.push(gte(telecomTransactions.createdAt, input.from));
  if (input.to) conditions.push(lte(telecomTransactions.createdAt, input.to));
  if (input.customerId) conditions.push(eq(telecomTransactions.userId, input.customerId));
  if (input.currency) conditions.push(eq(wallets.currencyCode, input.currency));
  if (input.status) conditions.push(eq(telecomTransactions.status, input.status));
  if (input.type) conditions.push(eq(telecomTransactions.productType, input.type));
  if (input.provider) conditions.push(eq(telecomTransactions.provider, input.provider));
  if (input.country) conditions.push(eq(users.countryCode, input.country));
  if (input.search) {
    const like = `%${input.search}%`;
    conditions.push(
      or(
        ilike(telecomTransactions.internalReference, like),
        ilike(telecomTransactions.providerReference, like),
        ilike(users.firstName, like),
        ilike(users.lastName, like),
        ilike(users.email, like),
        ilike(users.phone, like),
      ),
    );
  }

  const orderBy = input.sort === "amount"
    ? sql`${telecomTransactions.amount} ${sql.raw(input.order)}`
    : sql`${telecomTransactions.createdAt} ${sql.raw(input.order)}`;

  const rows = await db
    .select({
      id: telecomTransactions.id,
      internalReference: telecomTransactions.internalReference,
      userId: telecomTransactions.userId,
      customerFirst: users.firstName,
      customerLast: users.lastName,
      type: telecomTransactions.productType,
      amount: telecomTransactions.amount,
      currency: wallets.currencyCode,
      status: telecomTransactions.status,
      provider: telecomTransactions.provider,
      providerReference: telecomTransactions.providerReference,
      date: telecomTransactions.createdAt,
    })
    .from(telecomTransactions)
    .innerJoin(users, eq(users.id, telecomTransactions.userId))
    .innerJoin(wallets, eq(wallets.id, telecomTransactions.walletId))
    .where(conditions.length ? and(...conditions) : sql`true`)
    .orderBy(orderBy)
    .limit(input.limit)
    .offset(input.offset);

  return rows.map((r) => ({
    id: r.id,
    internalReference: r.internalReference,
    userId: r.userId,
    customerName: [r.customerFirst, r.customerLast].filter(Boolean).join(" ") || null,
    type: r.type,
    amount: r.amount,
    currency: r.currency,
    status: r.status,
    provider: r.provider,
    providerReference: r.providerReference,
    date: r.date,
  }));
}

export async function countBills(filters: Parameters<typeof listBills>[0]) {
  const conditions: any[] = [];
  if (filters.from) conditions.push(gte(telecomTransactions.createdAt, filters.from));
  if (filters.to) conditions.push(lte(telecomTransactions.createdAt, filters.to));
  if (filters.customerId) conditions.push(eq(telecomTransactions.userId, filters.customerId));
  if (filters.currency) conditions.push(eq(wallets.currencyCode, filters.currency));
  if (filters.status) conditions.push(eq(telecomTransactions.status, filters.status));
  if (filters.type) conditions.push(eq(telecomTransactions.productType, filters.type));
  if (filters.provider) conditions.push(eq(telecomTransactions.provider, filters.provider));
  if (filters.country) conditions.push(eq(users.countryCode, filters.country));
  if (filters.search) {
    const like = `%${filters.search}%`;
    conditions.push(
      or(
        ilike(telecomTransactions.internalReference, like),
        ilike(telecomTransactions.providerReference, like),
        ilike(users.firstName, like),
        ilike(users.lastName, like),
        ilike(users.email, like),
        ilike(users.phone, like),
      ),
    );
  }
  const row = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(telecomTransactions)
    .innerJoin(users, eq(users.id, telecomTransactions.userId))
    .innerJoin(wallets, eq(wallets.id, telecomTransactions.walletId))
    .where(conditions.length ? and(...conditions) : sql`true`);
  return row[0]?.c ?? 0;
}

export async function getBillById(id: string) {
  const rows = await db
    .select({
      id: telecomTransactions.id,
      internalReference: telecomTransactions.internalReference,
      userId: telecomTransactions.userId,
      walletId: telecomTransactions.walletId,
      type: telecomTransactions.productType,
      amount: telecomTransactions.amount,
      status: telecomTransactions.status,
      provider: telecomTransactions.provider,
      providerReference: telecomTransactions.providerReference,
      providerResponse: telecomTransactions.providerResponse,
      date: telecomTransactions.createdAt,
      userFirst: users.firstName,
      userLast: users.lastName,
      email: users.email,
      phone: users.phone,
      countryCode: users.countryCode,
      currencyCode: users.currencyCode,
      walletStatus: wallets.status,
    })
    .from(telecomTransactions)
    .innerJoin(users, eq(users.id, telecomTransactions.userId))
    .innerJoin(wallets, eq(wallets.id, telecomTransactions.walletId))
    .where(eq(telecomTransactions.id, id))
    .limit(1);
  return rows[0] ?? null;
}
