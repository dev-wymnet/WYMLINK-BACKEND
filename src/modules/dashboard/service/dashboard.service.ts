import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../../../core/db/client.js";
import { vtuOrders, walletLedger } from "../../../core/db/schema.js";
import { getMe } from "../../user/service/user.service.js";
import { getWalletDetails } from "../../wallet/service/wallet.service.js";
import { toOrderDto } from "../../vtu/vtu.service.js";

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export async function getDashboardHome(userId: string) {
  const [user, { wallet, virtualAccount }, totals, counts, ledger, orders] = await Promise.all([
    getMe(userId),
    getWalletDetails(userId),
    // Funded = deposits in; spent = purchases + payouts + fees, net of refunds.
    db
      .select({
        funded: sql<string>`coalesce(sum(${walletLedger.amount}) filter (where ${walletLedger.entryType} in ('deposit', 'transfer_in')), 0)::text`,
        spent: sql<string>`coalesce(sum(${walletLedger.amount}) filter (where ${walletLedger.direction} = 'debit'), 0)::text`,
        refunded: sql<string>`coalesce(sum(${walletLedger.amount}) filter (where ${walletLedger.entryType} in ('refund', 'reversal')), 0)::text`,
      })
      .from(walletLedger)
      .where(eq(walletLedger.userId, userId)),
    db
      .select({
        airtime: sql<number>`count(*) filter (where ${vtuOrders.product} = 'airtime')::int`,
        data: sql<number>`count(*) filter (where ${vtuOrders.product} = 'data')::int`,
      })
      .from(vtuOrders)
      .where(and(eq(vtuOrders.userId, userId), eq(vtuOrders.status, "success"))),
    db.select().from(walletLedger).where(eq(walletLedger.userId, userId)).orderBy(desc(walletLedger.createdAt)).limit(5),
    db.select().from(vtuOrders).where(eq(vtuOrders.userId, userId)).orderBy(desc(vtuOrders.createdAt)).limit(5),
  ]);

  const t = totals[0];
  const recentTransactions = [
    // Purchases show as orders (with their delivery status); their ledger lines are skipped.
    ...ledger
      .filter((l) => l.relatedType !== "vtu_order")
      .map((l) => ({ id: l.id, source: "wallet" as const, transactionType: l.entryType, amount: num(l.amount), status: "success", timestamp: l.createdAt })),
    ...orders.map((o) => {
      const dto = toOrderDto(o);
      return { id: o.id, source: "telecom" as const, transactionType: o.product, amount: num(o.amount), status: dto.status, timestamp: o.createdAt };
    }),
  ]
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, 5);

  return {
    user: { id: user.id, fullName: `${user.firstName} ${user.lastName}`.trim(), email: user.email, phone: user.phone },
    wallet: {
      balance: num(wallet.availableBalance),
      currency: wallet.currencyCode,
      accountNumber: virtualAccount?.accountNumber ?? "",
      bankName: virtualAccount?.bankName ?? "",
    },
    analytics: {
      totalFunded: num(t?.funded),
      totalSpent: Math.max(0, num(t?.spent) - num(t?.refunded)),
      airtimePurchases: counts[0]?.airtime ?? 0,
      dataPurchases: counts[0]?.data ?? 0,
    },
    recentTransactions,
  };
}
