import { createHmac } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";

import { env } from "../../../core/config/env.js";
import { db } from "../../../core/db/client.js";
import { kycAttempts, kycProfiles } from "../../../core/db/schema.js";
import { ValidationError } from "../../../core/errors/ValidationError.js";
import { NotFoundError } from "../../../core/errors/NotFoundError.js";
import { logger } from "../../../core/logger/logger.js";
import { findBank } from "../../../core/data/banks.js";
import { findUserById } from "../../user/repository/user.repository.js";
import { bvnAccountIdentityCheck, monetaBvnConfigured } from "../../moneta/moneta.bvn.js";
import {
  getKycProfile,
  recordKycAttempt,
  syncKycTier,
  upsertKycProfile,
  type KycProfile,
} from "../repository/verification.repository.js";

// BVN/NIN are never stored: only a keyed hash (one identity per account) and the last 4 digits.
const identityHash = (kind: "bvn" | "nin", value: string) =>
  createHmac("sha256", env.KYC_HASH_SECRET).update(`${kind}:${value}`).digest("hex");

// True when `bvn` and `nin` are exactly the customer's verified BVN and NIN.
// Lets a feature that needs the plain numbers (Moneta account creation) use what
// the customer re-types without Wymlink ever storing them.
export async function matchesVerifiedIdentity(userId: string, bvn: string, nin: string) {
  const p = await getKycProfile(userId);
  return (
    p?.bvnStatus === "verified" &&
    p?.ninStatus === "verified" &&
    p.bvnHash === identityHash("bvn", bvn) &&
    p.ninHash === identityHash("nin", nin)
  );
}

// Minimum name similarity Moneta must report between the bank account and the profile.
const NAME_MATCH_MIN = 70;

const ALREADY_LINKED = "This number is already verified on another Wymlink account. Sign in to that account, or contact support.";

const isUniqueViolation = (err: any) => (err?.code ?? err?.cause?.code) === "23505";

async function lastFailureReason(userId: string, kind: "bvn" | "nin") {
  const kinds = kind === "bvn" ? ["bvn", "bvn_account_match"] : ["nin"];
  const rows = await db
    .select({ kind: kycAttempts.kind, reason: kycAttempts.failureReason })
    .from(kycAttempts)
    .where(and(eq(kycAttempts.userId, userId), eq(kycAttempts.outcome, "failed")))
    .orderBy(desc(kycAttempts.createdAt))
    .limit(5);
  return rows.find((r) => kinds.includes(r.kind))?.reason ?? null;
}

function item(status: string, verifiedAt: Date | null, last4: string | null) {
  return { status: status.toUpperCase(), verifiedAt, masked: last4 ? `*******${last4}` : null };
}

export async function getMyVerificationStatus(userId: string) {
  const user = await findUserById(userId);
  if (!user) throw new NotFoundError("User not found");
  const p = await getKycProfile(userId);
  const bvn = item(p?.bvnStatus ?? "none", p?.bvnVerifiedAt ?? null, p?.bvnLast4 ?? null);
  const nin = item(p?.ninStatus ?? "none", p?.ninVerifiedAt ?? null, p?.ninLast4 ?? null);
  return {
    tier: user.kycTier,
    bvn: { ...bvn, reason: p?.bvnStatus === "failed" ? await lastFailureReason(userId, "bvn") : null },
    nin: { ...nin, reason: p?.ninStatus === "failed" ? await lastFailureReason(userId, "nin") : null },
  };
}

async function linkedElsewhere(userId: string, kind: "bvn" | "nin", hash: string) {
  const col = kind === "bvn" ? kycProfiles.bvnHash : kycProfiles.ninHash;
  const status = kind === "bvn" ? kycProfiles.bvnStatus : kycProfiles.ninStatus;
  const rows = await db
    .select({ userId: kycProfiles.userId })
    .from(kycProfiles)
    .where(and(eq(col, hash), eq(status, "verified")))
    .limit(2);
  return rows.some((r) => r.userId !== userId);
}

// Marks one identity verified and raises the tier, atomically.
async function markVerified(userId: string, kind: "bvn" | "nin", hash: string, last4: string, provider: string) {
  try {
    await db.transaction(async (tx) => {
      await upsertKycProfile(
        tx,
        userId,
        kind === "bvn"
          ? { bvnHash: hash, bvnLast4: last4, bvnStatus: "verified", bvnVerifiedAt: new Date(), provider }
          : { ninHash: hash, ninLast4: last4, ninStatus: "verified", ninVerifiedAt: new Date(), provider },
      );
      await syncKycTier(tx, userId);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ValidationError(ALREADY_LINKED);
    throw err;
  }
}

async function markStatus(userId: string, kind: "bvn" | "nin", hash: string, last4: string, status: "pending" | "failed") {
  await upsertKycProfile(
    db,
    userId,
    kind === "bvn"
      ? { bvnHash: hash, bvnLast4: last4, bvnStatus: status, bvnVerifiedAt: null }
      : { ninHash: hash, ninLast4: last4, ninStatus: status, ninVerifiedAt: null },
  );
}

const alreadyVerified = (p: KycProfile | null, kind: "bvn" | "nin") =>
  kind === "bvn" ? p?.bvnStatus === "verified" : p?.ninStatus === "verified";

// BVN: the customer's own bank account must belong to the BVN, and the account
// name must match their Wymlink name (Moneta NIBSS account identity check).
// Without Moneta configured, or when the check can't complete, the BVN waits
// for staff review instead of failing.
export async function submitBvnVerification(input: {
  userId: string;
  bvn: string;
  bankCode: string;
  accountNumber: string;
}) {
  const user = await findUserById(input.userId);
  if (!user) throw new NotFoundError("User not found");
  if (alreadyVerified(await getKycProfile(input.userId), "bvn")) return getMyVerificationStatus(input.userId);

  const bank = findBank(input.bankCode);
  if (!bank) throw new ValidationError("Choose your bank from the list");

  const hash = identityHash("bvn", input.bvn);
  const last4 = input.bvn.slice(-4);
  if (await linkedElsewhere(input.userId, "bvn", hash)) {
    await recordKycAttempt({ userId: input.userId, kind: "bvn_account_match", outcome: "failed", provider: "wymlink", failureReason: "already_linked" });
    throw new ValidationError(ALREADY_LINKED);
  }

  if (!monetaBvnConfigured()) {
    await markStatus(input.userId, "bvn", hash, last4, "pending");
    await recordKycAttempt({ userId: input.userId, kind: "bvn", outcome: "started", provider: "manual" });
    return getMyVerificationStatus(input.userId);
  }

  let check: Awaited<ReturnType<typeof bvnAccountIdentityCheck>>;
  try {
    check = await bvnAccountIdentityCheck({
      bvn: input.bvn,
      accountNumber: input.accountNumber,
      institutionCode: bank.code,
      // The profile's own name, never a name typed into the form.
      firstName: user.firstName,
      lastName: user.lastName,
    });
  } catch (err) {
    logger.warn({ userId: input.userId, err: (err as Error).message }, "kyc_bvn_provider_error");
    await markStatus(input.userId, "bvn", hash, last4, "pending");
    await recordKycAttempt({ userId: input.userId, kind: "bvn_account_match", outcome: "error", provider: "moneta", failureReason: "provider_error" });
    return getMyVerificationStatus(input.userId);
  }

  if (!check.ok) {
    await markStatus(input.userId, "bvn", hash, last4, "pending");
    await recordKycAttempt({ userId: input.userId, kind: "bvn_account_match", outcome: "error", provider: "moneta", providerReference: check.reference, failureReason: "provider_error" });
    return getMyVerificationStatus(input.userId);
  }

  const reason = !check.bvnMatch ? "account_not_linked_to_bvn" : check.nameMatchPercentage < NAME_MATCH_MIN ? "name_mismatch" : null;
  if (reason) {
    await markStatus(input.userId, "bvn", hash, last4, "failed");
    await recordKycAttempt({ userId: input.userId, kind: "bvn_account_match", outcome: "failed", provider: "moneta", providerReference: check.reference, failureReason: reason });
    throw new ValidationError(
      reason === "name_mismatch"
        ? "The name on that bank account doesn't match the name on your Wymlink account."
        : "That bank account isn't linked to this BVN. Use an account opened with your BVN.",
    );
  }

  await markVerified(input.userId, "bvn", hash, last4, "moneta");
  await recordKycAttempt({ userId: input.userId, kind: "bvn_account_match", outcome: "verified", provider: "moneta", providerReference: check.reference });
  return getMyVerificationStatus(input.userId);
}

// NIN: no automated provider yet, so every NIN is reviewed by staff.
export async function submitNinVerification(input: { userId: string; nin: string }) {
  if (alreadyVerified(await getKycProfile(input.userId), "nin")) return getMyVerificationStatus(input.userId);
  const hash = identityHash("nin", input.nin);
  if (await linkedElsewhere(input.userId, "nin", hash)) {
    await recordKycAttempt({ userId: input.userId, kind: "nin", outcome: "failed", provider: "wymlink", failureReason: "already_linked" });
    throw new ValidationError(ALREADY_LINKED);
  }
  await markStatus(input.userId, "nin", hash, input.nin.slice(-4), "pending");
  await recordKycAttempt({ userId: input.userId, kind: "nin", outcome: "started", provider: "manual" });
  return getMyVerificationStatus(input.userId);
}

// Staff decision on a pending (or failed) BVN/NIN.
export async function reviewKyc(input: { userId: string; kind: "bvn" | "nin"; decision: "approve" | "reject"; reason?: string }) {
  const p = await getKycProfile(input.userId);
  const hash = input.kind === "bvn" ? p?.bvnHash : p?.ninHash;
  const last4 = input.kind === "bvn" ? p?.bvnLast4 : p?.ninLast4;
  if (!p || !hash || !last4) throw new ValidationError(`This customer hasn't submitted a ${input.kind.toUpperCase()}`);

  if (input.decision === "approve") {
    await markVerified(input.userId, input.kind, hash, last4, "manual_review");
    await recordKycAttempt({ userId: input.userId, kind: input.kind, outcome: "verified", provider: "manual_review" });
  } else {
    await markStatus(input.userId, input.kind, hash, last4, "failed");
    await db.transaction((tx) => syncKycTier(tx, input.userId));
    await recordKycAttempt({ userId: input.userId, kind: input.kind, outcome: "failed", provider: "manual_review", failureReason: input.reason ?? "rejected_by_review" });
  }
  return getMyVerificationStatus(input.userId);
}
