import { eq, sql } from "drizzle-orm";

import { db } from "../../../core/db/client.js";
import { tierLimits, users } from "../../../core/db/schema.js";
import {
  BvnVerificationRequiredError,
  LimitExceededError,
} from "../../../core/errors/AppError.js";
import { centsToMoneyString, parseMoneyToCents } from "../../../core/utils/money.js";
import type { Executor } from "../../wallet/repository/wallet.repository.js";

const naira = (cents: bigint) =>
  `₦${Number(centsToMoneyString(cents)).toLocaleString("en-NG")}`;

// Spending limits come from the customer's KYC tier (app.tier_limits).
// Today's spend is app.debits_today (Lagos day, refunds excluded).
// Run inside the debit's transaction so the check and the debit agree.
export async function enforceSpendLimit(
  ex: Executor,
  input: { userId: string; amountCents: bigint },
) {
  const rows = await ex
    .select({ tier: users.kycTier, singleMax: tierLimits.singleMax, dailyMax: tierLimits.dailyMax })
    .from(users)
    .innerJoin(tierLimits, eq(tierLimits.tier, users.kycTier))
    .where(eq(users.id, input.userId))
    .limit(1);
  const limit = rows[0];
  if (!limit) throw new LimitExceededError("No spending limit is configured for this account");

  const single = parseMoneyToCents(limit.singleMax);
  const daily = parseMoneyToCents(limit.dailyMax);

  const spent = await ex.execute(sql`select app.debits_today(${input.userId}::uuid)::text as total`);
  const today = parseMoneyToCents(String((spent.rows[0] as { total: string }).total));

  const over = input.amountCents > single || today + input.amountCents > daily;
  if (!over) return;

  // Unverified customers raise their limit by verifying, not by asking.
  if (limit.tier === 0) {
    throw new BvnVerificationRequiredError(
      `Verify your BVN or NIN to spend more than ${naira(daily)} a day.`,
    );
  }
  const left = daily - today > 0n ? daily - today : 0n;
  throw new LimitExceededError(
    input.amountCents > single
      ? `The most you can spend in one transaction is ${naira(single)}.`
      : `This would take you over your daily limit of ${naira(daily)}. You have ${naira(left)} left today.`,
    { tier: limit.tier, singleMax: limit.singleMax, dailyMax: limit.dailyMax, spentToday: centsToMoneyString(today) },
  );
}

export async function getLimitsForUser(userId: string) {
  const rows = await db
    .select({
      tier: users.kycTier,
      label: tierLimits.label,
      singleMax: tierLimits.singleMax,
      dailyMax: tierLimits.dailyMax,
      balanceMax: tierLimits.balanceMax,
    })
    .from(users)
    .innerJoin(tierLimits, eq(tierLimits.tier, users.kycTier))
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0] ?? null;
}
