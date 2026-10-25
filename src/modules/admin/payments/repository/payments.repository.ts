import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";

import { db } from "../../../../core/db/client.js";
import {
  users,
  walletLedger,
  wallets,
  payouts,
  telecomTransactions,
} from "../../../../core/db/schema.js";

export type AdminPaymentRow = {
  id: string;
  reference: string;
  userId: string;
  customerName: string | null;
  type: string;
  direction: string;
  amount: string;
  currency: string;
  balanceBefore: string;
  balanceAfter: string;
  status: string;
  provider?: string | null;
  providerReference?: string | null;
  description?: string | null;
  date: Date;
};

export async function listLedgerPayments(input: {
  from?: Date | undefined;
  to?: Date | undefined;
  customerId?: string | undefined;
  search?: string | undefined;
  country?: string | undefined;
  currency?: string | undefined;
  status?: string | undefined;
  type?: string | undefined;
  direction?: "credit" | "debit" | undefined;
  provider?: string | undefined;
  limit: number;
  offset: number;
  sort: "date" | "amount";
  order: "asc" | "desc";
}): Promise<AdminPaymentRow[]> {
  const conditions: any[] = [];
  if (input.from) conditions.push(gte(walletLedger.createdAt, input.from));
  if (input.to) conditions.push(lte(walletLedger.createdAt, input.to));
  if (input.customerId)
    conditions.push(eq(walletLedger.userId, input.customerId));
  if (input.currency)
    conditions.push(eq(walletLedger.currencyCode, input.currency));
  if (input.status) conditions.push(eq(walletLedger.status, input.status));
  if (input.type) conditions.push(eq(walletLedger.transactionType, input.type));
  if (input.direction)
    conditions.push(eq(walletLedger.direction, input.direction));
  if (input.search) {
    const like = `%${input.search}%`;
    conditions.push(
      or(
        ilike(walletLedger.referenceCode, like),
        ilike(walletLedger.relatedOrderId, like),
        ilike(users.firstName, like),
        ilike(users.lastName, like),
        ilike(users.email, like),
        ilike(users.phone, like),
      ),
    );
  }

  const orderBy =
    input.sort === "amount"
      ? sql`${walletLedger.amount} ${sql.raw(input.order)}`
      : sql`${walletLedger.createdAt} ${sql.raw(input.order)}`;

  const rows = await db
    .select({
      id: walletLedger.id,
      reference: walletLedger.referenceCode,
      userId: walletLedger.userId,
      customerFirst: users.firstName,
      customerLast: users.lastName,
      type: walletLedger.transactionType,
      direction: walletLedger.direction,
      amount: walletLedger.amount,
      currency: walletLedger.currencyCode,
      balanceBefore: walletLedger.balanceBefore,
      balanceAfter: walletLedger.balanceAfter,
      status: walletLedger.status,
      description: walletLedger.description,
      date: walletLedger.createdAt,
    })
    .from(walletLedger)
    .innerJoin(users, eq(users.id, walletLedger.userId))
    .where(conditions.length ? and(...conditions) : sql`true`)
    .orderBy(orderBy)
    .limit(input.limit)
    .offset(input.offset);

  return rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    userId: r.userId,
    customerName:
      [r.customerFirst, r.customerLast].filter(Boolean).join(" ") || null,
    type: r.type,
    direction: r.direction,
    amount: r.amount,
    currency: r.currency,
    balanceBefore: r.balanceBefore,
    balanceAfter: r.balanceAfter,
    status: r.status,
    description: r.description ?? undefined,
    date: r.date,
  }));
}

export async function countLedgerPayments(
  filters: Parameters<typeof listLedgerPayments>[0],
) {
  const conditions: any[] = [];
  if (filters.from) conditions.push(gte(walletLedger.createdAt, filters.from));
  if (filters.to) conditions.push(lte(walletLedger.createdAt, filters.to));
  if (filters.customerId)
    conditions.push(eq(walletLedger.userId, filters.customerId));
  if (filters.currency)
    conditions.push(eq(walletLedger.currencyCode, filters.currency));
  if (filters.status) conditions.push(eq(walletLedger.status, filters.status));
  if (filters.type)
    conditions.push(eq(walletLedger.transactionType, filters.type));
  if (filters.direction)
    conditions.push(eq(walletLedger.direction, filters.direction));
  if (filters.search) {
    const like = `%${filters.search}%`;
    conditions.push(
      or(
        ilike(walletLedger.referenceCode, like),
        ilike(walletLedger.relatedOrderId, like),
        ilike(users.firstName, like),
        ilike(users.lastName, like),
        ilike(users.email, like),
        ilike(users.phone, like),
      ),
    );
  }
  const row = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(walletLedger)
    .innerJoin(users, eq(users.id, walletLedger.userId))
    .where(conditions.length ? and(...conditions) : sql`true`);
  return row[0]?.c ?? 0;
}

export async function getLedgerPaymentById(id: string) {
  const rows = await db
    .select({
      id: walletLedger.id,
      reference: walletLedger.referenceCode,
      userId: walletLedger.userId,
      walletId: walletLedger.walletId,
      type: walletLedger.transactionType,
      direction: walletLedger.direction,
      amount: walletLedger.amount,
      currency: walletLedger.currencyCode,
      balanceBefore: walletLedger.balanceBefore,
      balanceAfter: walletLedger.balanceAfter,
      description: walletLedger.description,
      status: walletLedger.status,
      date: walletLedger.createdAt,
      userFirst: users.firstName,
      userLast: users.lastName,
      email: users.email,
      phone: users.phone,
      countryCode: users.countryCode,
      currencyCode: users.currencyCode,
      walletStatus: wallets.status,
    })
    .from(walletLedger)
    .innerJoin(users, eq(users.id, walletLedger.userId))
    .innerJoin(wallets, eq(wallets.id, walletLedger.walletId))
    .where(eq(walletLedger.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function findRelatedPayoutByReference(reference: string) {
  const rows = await db
    .select()
    .from(payouts)
    .where(eq(payouts.reference, reference))
    .limit(1);
  return rows[0] ?? null;
}

export async function findTelecomByInternalReference(
  internalReference: string,
) {
  const rows = await db
    .select()
    .from(telecomTransactions)
    .where(eq(telecomTransactions.internalReference, internalReference))
    .limit(1);
  return rows[0] ?? null;
}
