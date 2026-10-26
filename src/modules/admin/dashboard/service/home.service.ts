import { and, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";

import { db } from "../../../../core/db/client.js";
import { kycProfiles, users, vtuOrders, walletLedger } from "../../../../core/db/schema.js";

const lagosMidnight = sql`(date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos')`;

export async function getAdminHomeSummary(input: { from?: Date | undefined; to?: Date | undefined }) {
  const { from, to } = input;
  const range = (col: any): SQL | undefined =>
    from || to ? and(...[from ? gte(col, from) : undefined, to ? lte(col, to) : undefined].filter(Boolean) as SQL[]) : undefined;

  const [recentCustomers, recentTx, volume, billsUsage, customers, attention, kycQueue, drift] = await Promise.all([
    db
      .select({ u: users, bvn: kycProfiles.bvnStatus, nin: kycProfiles.ninStatus })
      .from(users)
      .leftJoin(kycProfiles, eq(kycProfiles.userId, users.id))
      .where(eq(users.role, "customer"))
      .orderBy(desc(users.createdAt))
      .limit(10),
    db
      .select({ e: walletLedger, firstName: users.firstName, lastName: users.lastName })
      .from(walletLedger)
      .innerJoin(users, eq(users.id, walletLedger.userId))
      .orderBy(desc(walletLedger.createdAt))
      .limit(10),
    db
      .select({
        totalCount: sql<number>`count(*)::int`,
        credits: sql<string>`coalesce(sum(${walletLedger.amount}) filter (where ${walletLedger.direction} = 'credit'), 0)::text`,
        debits: sql<string>`coalesce(sum(${walletLedger.amount}) filter (where ${walletLedger.direction} = 'debit'), 0)::text`,
        deposits: sql<string>`coalesce(sum(${walletLedger.amount}) filter (where ${walletLedger.entryType} = 'deposit'), 0)::text`,
      })
      .from(walletLedger)
      .where(range(walletLedger.createdAt)),
    db
      .select({
        type: vtuOrders.product,
        transactionCount: sql<number>`count(*)::int`,
        delivered: sql<number>`count(*) filter (where ${vtuOrders.status} = 'success')::int`,
        refunded: sql<number>`count(*) filter (where ${vtuOrders.status} = 'refunded')::int`,
        totalAmount: sql<string>`coalesce(sum(${vtuOrders.amount}) filter (where ${vtuOrders.status} = 'success'), 0)::text`,
      })
      .from(vtuOrders)
      .where(range(vtuOrders.createdAt))
      .groupBy(vtuOrders.product)
      .orderBy(desc(sql`count(*)`)),
    db
      .select({
        total: sql<number>`count(*)::int`,
        today: sql<number>`count(*) filter (where ${users.createdAt} >= ${lagosMidnight})::int`,
        verifiedKyc: sql<number>`count(*) filter (where ${users.kycTier} > 0)::int`,
      })
      .from(users)
      .where(eq(users.role, "customer")),
    db.select({ c: sql<number>`count(*)::int` }).from(vtuOrders).where(inArray(vtuOrders.status, ["unknown", "processing", "pending"])),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(kycProfiles)
      .where(sql`${kycProfiles.bvnStatus} = 'pending' or ${kycProfiles.ninStatus} = 'pending'`),
    db.execute(sql`select count(*)::int as c from app.wallet_drift`),
  ]);

  const kyc = (bvn: string | null, nin: string | null) =>
    bvn === "verified" || nin === "verified" ? "verified" : bvn === "pending" || nin === "pending" ? "review" : bvn === "failed" || nin === "failed" ? "failed" : "none";

  return {
    recentCustomers: recentCustomers.map(({ u, bvn, nin }) => ({
      id: u.id,
      name: `${u.firstName} ${u.lastName}`.trim(),
      email: u.email,
      phone: u.phone,
      joinedAt: u.createdAt,
      kycStatus: kyc(bvn, nin),
    })),
    recentTransactions: recentTx.map(({ e, firstName, lastName }) => ({
      id: e.id,
      customerId: e.userId,
      customerName: `${firstName} ${lastName}`.trim(),
      type: e.entryType,
      direction: e.direction,
      amount: e.amount,
      currency: "NGN",
      status: "success",
      description: e.description,
      createdAt: e.createdAt,
    })),
    analytics: {
      range: { from: from ?? null, to: to ?? null, default: from || to ? null : "all_time" },
      transactionVolume: {
        totalCount: volume[0]?.totalCount ?? 0,
        totalCredits: volume[0]?.credits ?? "0",
        totalDebits: volume[0]?.debits ?? "0",
        totalDeposits: volume[0]?.deposits ?? "0",
      },
      billsUsage,
      customers: {
        total: customers[0]?.total ?? 0,
        today: customers[0]?.today ?? 0,
        verifiedKyc: customers[0]?.verifiedKyc ?? 0,
      },
    },
    attention: {
      // Purchases the provider never confirmed: resolve under Bills.
      unconfirmedOrders: attention[0]?.c ?? 0,
      kycAwaitingReview: kycQueue[0]?.c ?? 0,
      // Wallets whose balance disagrees with their ledger. Must always be 0.
      walletDrift: Number((drift.rows[0] as { c: number } | undefined)?.c ?? 0),
    },
  };
}
