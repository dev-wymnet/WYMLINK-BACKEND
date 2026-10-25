import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "../../../core/db/client.js";
import { walletLedger } from "../../../core/db/schema.js";
import { ValidationError } from "../../../core/errors/ValidationError.js";
import {
  BvnVerificationRequiredError,
  NinVerificationRequiredError,
} from "../../../core/errors/AppError.js";
import { getUserVerification } from "../../verification/repository/verification.repository.js";

const NG_BVN_THRESHOLD_KOBO = 10_000n * 100n;
const NG_NIN_THRESHOLD_KOBO = 500_000n * 100n;

function nairaToKoboString(amount: string): bigint {
  const [wa, fa] = amount.split(".");
  const w = (wa ?? "0").replace(/[^0-9-]/g, "");
  const f = (fa ?? "0").replace(/[^0-9]/g, "");
  const frac = (f + "00").slice(0, 2);
  const whole = w === "" || w === "-" ? "0" : w;
  return BigInt(whole) * 100n + BigInt(frac);
}

export async function getNgDailyDebitTotalKobo(input: {
  userId: string;
  currencyCode: string;
  tx?: any;
}): Promise<bigint> {
  const executor: any = input.tx ?? db;

  const totals = await executor
    .select({
      total: sql`COALESCE(SUM(${walletLedger.amount}), 0)` as any,
    })
    .from(walletLedger)
    .where(
      and(
        eq(walletLedger.userId, input.userId),
        eq(walletLedger.currencyCode, input.currencyCode),
        eq(walletLedger.direction, "debit"),
        eq(walletLedger.status, "success"),
        inArray(walletLedger.transactionType, ["purchase", "payout"]),
        sql`${walletLedger.createdAt} >= (((now() at time zone 'Africa/Lagos')::date) at time zone 'Africa/Lagos')`,
        sql`${walletLedger.createdAt} < ((((now() at time zone 'Africa/Lagos')::date) + interval '1 day') at time zone 'Africa/Lagos')`,
      ),
    );

  const numeric = String((totals[0] as any)?.total ?? "0");
  const [wa, fa] = numeric.split(".");
  const w = (wa ?? "0").replace(/[^0-9-]/g, "");
  const f = (fa ?? "0").replace(/[^0-9]/g, "");
  const frac = (f + "00").slice(0, 2);
  const whole = w === "" || w === "-" ? "0" : w;
  return BigInt(whole) * 100n + BigInt(frac);
}

export async function checkNgVerificationRequirement(input: {
  userId: string;
  currencyCode: string;
  amount: string;
  tx?: any;
}): Promise<
  | {
      allowed: true;
      dailyTotalKobo: bigint;
      resultingTotalKobo: bigint;
      bvnVerified: boolean;
      ninVerified: boolean;
    }
  | {
      allowed: false;
      code: "BVN_VERIFICATION_REQUIRED" | "NIN_VERIFICATION_REQUIRED";
      dailyTotalKobo: bigint;
      resultingTotalKobo: bigint;
      bvnVerified: boolean;
      ninVerified: boolean;
    }
> {
  const amountKobo = nairaToKoboString(input.amount);
  const dailyTotalKobo = await getNgDailyDebitTotalKobo({
    userId: input.userId,
    currencyCode: input.currencyCode,
    tx: input.tx,
  });
  const resultingTotalKobo = dailyTotalKobo + amountKobo;

  const ver = await getUserVerification(input.userId);
  const bvnVerified = (ver?.bvnStatus ?? "PENDING") === "VERIFIED";
  const ninVerified = (ver?.ninStatus ?? "PENDING") === "VERIFIED";

  if (resultingTotalKobo > NG_NIN_THRESHOLD_KOBO && !ninVerified) {
    return {
      allowed: false,
      code: "NIN_VERIFICATION_REQUIRED",
      dailyTotalKobo,
      resultingTotalKobo,
      bvnVerified,
      ninVerified,
    } as const;
  }

  if (resultingTotalKobo > NG_BVN_THRESHOLD_KOBO && !bvnVerified) {
    return {
      allowed: false,
      code: "BVN_VERIFICATION_REQUIRED",
      dailyTotalKobo,
      resultingTotalKobo,
      bvnVerified,
      ninVerified,
    } as const;
  }

  return {
    allowed: true,
    dailyTotalKobo,
    resultingTotalKobo,
    bvnVerified,
    ninVerified,
  } as const;
}

export async function enforceNgVerificationRequirement(input: {
  userId: string;
  currencyCode: string;
  amount: string;
  tx?: any;
}) {
  const res = await checkNgVerificationRequirement(input);
  if (!res.allowed) {
    if (res.code === "BVN_VERIFICATION_REQUIRED")
      throw new BvnVerificationRequiredError();
    if (res.code === "NIN_VERIFICATION_REQUIRED")
      throw new NinVerificationRequiredError();
    throw new ValidationError(res.code);
  }
  return res;
}
