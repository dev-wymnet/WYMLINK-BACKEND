import { desc, eq, sql } from "drizzle-orm";

import { db } from "../../../core/db/client.js";
import { telecomTransactions, walletLedger } from "../../../core/db/schema.js";
import { getMe } from "../../user/service/user.service.js";
import { getWalletDetails } from "../../wallet/service/wallet.service.js";

function asNumber(input: unknown): number {
  const n = typeof input === "number" ? input : Number(input);
  return Number.isFinite(n) ? n : 0;
}

function fullName(user: { firstName: string; lastName: string }) {
  return `${user.firstName} ${user.lastName}`.trim();
}

export async function getDashboardHome(userId: string) {
  const [user, walletDetails] = await Promise.all([
    getMe(userId),
    getWalletDetails(userId),
  ]);

  const [walletAgg, telecomAgg] = await Promise.all([
    getWalletAnalytics(userId),
    getTelecomAnalytics(userId),
  ]);

  const recentTransactions = await listRecentTransactions({ userId, limit: 5 });

  return {
    user: {
      id: user.id,
      fullName: fullName(user),
      email: user.email,
      phone: user.phone,
    },
    wallet: {
      balance: asNumber(walletDetails.wallet.availableBalance),
      currency: walletDetails.wallet.currencyCode,
      accountNumber: walletDetails.reserved?.accountNumber ?? "",
      bankName: walletDetails.reserved?.bankName ?? "",
    },
    analytics: {
      totalFunded: walletAgg.totalFunded,
      totalSpent: walletAgg.totalSpent,
      airtimePurchases: telecomAgg.airtimePurchases,
      dataPurchases: telecomAgg.dataPurchases,
    },
    recentTransactions,
  };
}

async function getWalletAnalytics(userId: string) {
  const fundedRows = await db
    .select({
      total: sql<string>`coalesce(sum(${walletLedger.amount}), 0)::text`,
    })
    .from(walletLedger)
    .where(
      sql`${walletLedger.userId} = ${userId} and ${walletLedger.direction} = 'credit' and ${walletLedger.status} = 'success' and ${walletLedger.transactionType} = 'funding'`,
    );

  const spentRows = await db
    .select({
      total: sql<string>`coalesce(sum(${walletLedger.amount}), 0)::text`,
    })
    .from(walletLedger)
    .where(
      sql`${walletLedger.userId} = ${userId} and ${walletLedger.direction} = 'debit' and ${walletLedger.status} = 'success'`,
    );

  return {
    totalFunded: asNumber(fundedRows[0]?.total),
    totalSpent: asNumber(spentRows[0]?.total),
  };
}

async function getTelecomAnalytics(userId: string) {
  const airtimeRows = await db
    .select({ count: sql<string>`count(*)::text` })
    .from(telecomTransactions)
    .where(
      sql`${telecomTransactions.userId} = ${userId} and ${telecomTransactions.productType} = 'airtime'`,
    );

  const dataRows = await db
    .select({ count: sql<string>`count(*)::text` })
    .from(telecomTransactions)
    .where(
      sql`${telecomTransactions.userId} = ${userId} and ${telecomTransactions.productType} = 'data'`,
    );

  return {
    airtimePurchases: Number(airtimeRows[0]?.count ?? 0),
    dataPurchases: Number(dataRows[0]?.count ?? 0),
  };
}

async function listRecentTransactions(input: {
  userId: string;
  limit: number;
}) {
  const [walletRows, telecomRows] = await Promise.all([
    db
      .select({
        id: walletLedger.id,
        type: walletLedger.transactionType,
        amount: walletLedger.amount,
        status: walletLedger.status,
        createdAt: walletLedger.createdAt,
      })
      .from(walletLedger)
      .where(eq(walletLedger.userId, input.userId))
      .orderBy(desc(walletLedger.createdAt))
      .limit(input.limit),
    db
      .select({
        id: telecomTransactions.id,
        type: telecomTransactions.productType,
        amount: telecomTransactions.amount,
        status: telecomTransactions.status,
        createdAt: telecomTransactions.createdAt,
      })
      .from(telecomTransactions)
      .where(eq(telecomTransactions.userId, input.userId))
      .orderBy(desc(telecomTransactions.createdAt))
      .limit(input.limit),
  ]);

  const normalized = [
    ...walletRows.map((r) => ({
      id: r.id,
      source: "wallet" as const,
      transactionType: r.type,
      amount: asNumber(r.amount),
      status: r.status,
      timestamp: r.createdAt,
    })),
    ...telecomRows.map((r) => ({
      id: r.id,
      source: "telecom" as const,
      transactionType: r.type,
      amount: asNumber(r.amount),
      status: r.status,
      timestamp: r.createdAt,
    })),
  ];

  return normalized
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    )
    .slice(0, input.limit);
}
