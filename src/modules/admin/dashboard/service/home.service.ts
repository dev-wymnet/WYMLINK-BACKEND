import { and, desc, eq, gte, lte, sql } from "drizzle-orm";

import { db } from "../../../../core/db/client.js";
import {
  users,
  userVerifications,
  walletLedger,
  telecomTransactions,
} from "../../../../core/db/schema.js";

export async function getAdminHomeSummary(input: {
  from?: Date | undefined;
  to?: Date | undefined;
}) {
  const { from, to } = input;
  const dateCond = (col: any) =>
    and(from ? gte(col, from) : sql`true`, to ? lte(col, to) : sql`true`);

  // Recent customers (non-admin)
  const recentCustomers = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      phone: users.phone,
      joinedAt: users.createdAt,
      kycBvnStatus: userVerifications.bvnStatus,
      kycNinStatus: userVerifications.ninStatus,
    })
    .from(users)
    .leftJoin(userVerifications, eq(userVerifications.userId, users.id))
    .where(sql`${users.role} = 'customer'`)
    .orderBy(desc(users.createdAt))
    .limit(10);

  // Recent transactions from wallet ledger (authoritative)
  const recentTx = await db
    .select({
      id: walletLedger.id,
      userId: walletLedger.userId,
      firstName: users.firstName,
      lastName: users.lastName,
      type: walletLedger.transactionType,
      amount: walletLedger.amount,
      currency: walletLedger.currencyCode,
      status: walletLedger.status,
      createdAt: walletLedger.createdAt,
    })
    .from(walletLedger)
    .innerJoin(users, eq(users.id, walletLedger.userId))
    .orderBy(desc(walletLedger.createdAt))
    .limit(10);

  // Analytics: transaction volume within range (wallet ledger)
  const [volume] = await db
    .select({
      totalCount: sql<number>`count(*)::int`,
      totalAmount: sql<string>`COALESCE(sum(${walletLedger.amount})::text, '0')`,
      successCount: sql<number>`count(*) filter (where ${walletLedger.status} = 'success')::int`,
      failedCount: sql<number>`count(*) filter (where ${walletLedger.status} = 'failed')::int`,
      pendingCount: sql<number>`count(*) filter (where ${walletLedger.status} = 'pending')::int`,
    })
    .from(walletLedger)
    .where(dateCond(walletLedger.createdAt));

  // Bill/product usage analytics (telecom transactions)
  const billsUsage = await db
    .select({
      type: telecomTransactions.productType,
      transactionCount: sql<number>`count(*)::int`,
      totalAmount: sql<string>`COALESCE(sum(${telecomTransactions.amount})::text, '0')`,
    })
    .from(telecomTransactions)
    .where(dateCond(telecomTransactions.createdAt))
    .groupBy(telecomTransactions.productType)
    .orderBy(desc(sql`count(*)`));

  // Customer metrics
  const [totalCustomersRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(users)
    .where(sql`${users.role} = 'customer'`);
  const totalCustomers = totalCustomersRow?.c ?? 0;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const [todayCustomersRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(users)
    .where(
      and(sql`${users.role} = 'customer'`, gte(users.createdAt, startOfToday)),
    );

  const [verifiedKycAgg] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(userVerifications)
    .where(
      sql`${userVerifications.bvnStatus} = 'VERIFIED' OR ${userVerifications.ninStatus} = 'VERIFIED'`,
    );

  return {
    recentCustomers: recentCustomers.map((u) => ({
      id: u.id,
      name: [u.firstName, u.lastName].filter(Boolean).join(" "),
      email: u.email,
      phone: u.phone,
      joinedAt: u.joinedAt,
      kycStatus:
        u.kycBvnStatus === "VERIFIED" || u.kycNinStatus === "VERIFIED"
          ? "verified"
          : u.kycBvnStatus === "FAILED" || u.kycNinStatus === "FAILED"
            ? "failed"
            : "pending",
    })),
    recentTransactions: recentTx.map((t) => ({
      id: t.id,
      customerId: t.userId,
      customerName: [t.firstName, t.lastName].filter(Boolean).join(" "),
      type: t.type,
      amount: t.amount,
      currency: t.currency,
      status: t.status,
      createdAt: t.createdAt,
    })),
    analytics: {
      range: {
        from: from ?? null,
        to: to ?? null,
        default: from || to ? null : "current_month",
      },
      transactionVolume: {
        totalCount: volume?.totalCount ?? 0,
        totalAmount: volume?.totalAmount ?? "0",
        success: volume?.successCount ?? 0,
        failed: volume?.failedCount ?? 0,
        pending: volume?.pendingCount ?? 0,
      },
      billsUsage: billsUsage.map((b) => ({
        type: b.type,
        transactionCount: b.transactionCount,
        totalAmount: b.totalAmount,
      })),
      customers: {
        total: totalCustomers,
        today: todayCustomersRow?.c ?? 0,
        verifiedKyc: verifiedKycAgg?.c ?? 0,
      },
    },
  };
}
