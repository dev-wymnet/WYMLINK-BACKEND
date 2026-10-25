import { eq, and, sql } from "drizzle-orm";

import { db } from "../../../core/db/client.js";
import { transactionLimits, walletLedger } from "../../../core/db/schema.js";
import { ValidationError } from "../../../core/errors/ValidationError.js";

export async function checkTransactionLimit(input: {
  userId: string;
  currencyCode: string;
  amount: string;
  complianceRegion: string | null;
  complianceTier: string | null;
}) {
  const region = input.complianceRegion?.toUpperCase() || "UNKNOWN";
  const tier = input.complianceTier || "tier_1";

  const limitConfig = await db
    .select()
    .from(transactionLimits)
    .where(
      and(
        eq(transactionLimits.complianceRegion, region),
        eq(transactionLimits.complianceTier, tier),
        eq(transactionLimits.currencyCode, input.currencyCode),
      ),
    )
    .limit(1);

  if (!limitConfig[0]) {
    return { compliant: true, reason: "no_limit_config" };
  }

  const limit = limitConfig[0];
  const amount = Number(input.amount);

  if (isNaN(amount)) {
    return { compliant: true, reason: "invalid_amount" };
  }

  const transactionLimit = Number(limit.transactionLimit);
  if (amount > transactionLimit) {
    return {
      compliant: false,
      reason: "transaction_limit_exceeded",
      limit: transactionLimit,
      amount,
    };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dailyTotals = await db
    .select({
      total: sql`COALESCE(SUM(${walletLedger.amount}), 0)`,
    })
    .from(walletLedger)
    .where(
      and(
        eq(walletLedger.userId, input.userId),
        eq(walletLedger.currencyCode, input.currencyCode),
        eq(walletLedger.direction, "debit"),
        sql`${walletLedger.createdAt} >= ${today}`,
      ),
    );

  const dailyTotal = Number(dailyTotals[0]?.total || 0);
  const dailyLimit = Number(limit.dailyLimit);

  if (dailyTotal + amount > dailyLimit) {
    return {
      compliant: false,
      reason: "daily_limit_exceeded",
      limit: dailyLimit,
      current: dailyTotal,
      amount,
    };
  }

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const monthlyTotals = await db
    .select({
      total: sql`COALESCE(SUM(${walletLedger.amount}), 0)`,
    })
    .from(walletLedger)
    .where(
      and(
        eq(walletLedger.userId, input.userId),
        eq(walletLedger.currencyCode, input.currencyCode),
        eq(walletLedger.direction, "debit"),
        sql`${walletLedger.createdAt} >= ${monthStart}`,
      ),
    );

  const monthlyTotal = Number(monthlyTotals[0]?.total || 0);
  const monthlyLimit = Number(limit.monthlyLimit);

  if (monthlyTotal + amount > monthlyLimit) {
    return {
      compliant: false,
      reason: "monthly_limit_exceeded",
      limit: monthlyLimit,
      current: monthlyTotal,
      amount,
    };
  }

  return { compliant: true, reason: "within_limits" };
}

export async function enforceTransactionLimit(input: {
  userId: string;
  currencyCode: string;
  amount: string;
  complianceRegion: string | null;
  complianceTier: string | null;
}) {
  const result = await checkTransactionLimit(input);

  if (!result.compliant) {
    throw new ValidationError(
      `Transaction limit exceeded: ${result.reason}`,
    );
  }

  return result;
}
