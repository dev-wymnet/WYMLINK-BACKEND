import {
  monnifyBvnAccountMatch,
  monnifyNinVerification,
} from "../../monnify/client/monnify.client.js";
import { ValidationError } from "../../../core/errors/ValidationError.js";
import {
  upsertUserVerification,
  getUserVerification,
} from "../repository/verification.repository.js";

function maskSuffix(value: string | null | undefined): string | null {
  if (!value || value.length < 4) return null;
  const last4 = value.slice(-4);
  return `******${last4}`;
}

export async function getMyVerificationStatus(userId: string) {
  const ver = await getUserVerification(userId);
  return {
    bvn: {
      status: ver?.bvnStatus ?? "PENDING",
      verifiedAt: ver?.bvnVerifiedAt ?? null,
      masked: ver?.bvnSuffix ? `******${ver.bvnSuffix}` : null,
    },
    nin: {
      status: ver?.ninStatus ?? "PENDING",
      verifiedAt: ver?.ninVerifiedAt ?? null,
      masked: ver?.ninSuffix ? `******${ver.ninSuffix}` : null,
    },
  };
}

export async function submitBvnVerification(input: {
  userId: string;
  bvn: string;
  bankCode: string;
  accountNumber: string;
  name: string;
}) {
  const existing = await getUserVerification(input.userId);
  if (existing?.bvnStatus === "VERIFIED") {
    return getMyVerificationStatus(input.userId);
  }

  try {
    const resp = await monnifyBvnAccountMatch({
      bvn: input.bvn,
      bankCode: input.bankCode,
      accountNumber: input.accountNumber,
      name: input.name,
    });

    const code = (resp as any)?.responseCode;
    const body = (resp as any)?.responseBody ?? {};
    const match = Boolean(body.bvnAccountNameMatch);

    if (code !== "0" || !match) {
      await upsertUserVerification({
        userId: input.userId,
        bvnStatus: "FAILED",
        bvnFailureReason: match ? `code_${code}` : "name_mismatch",
        bvnVerifiedAt: null,
        bvnSuffix: input.bvn.slice(-4),
        bvn: null,
      });
      throw new ValidationError("BVN verification failed");
    }

    await upsertUserVerification({
      userId: input.userId,
      bvnStatus: "VERIFIED",
      bvnVerifiedAt: new Date(),
      bvnProviderReference: (body as any)?.reservationReference ?? null,
      bvnFailureReason: null,
      bvnSuffix: input.bvn.slice(-4),
      bvn: null,
    });

    return getMyVerificationStatus(input.userId);
  } catch (e) {
    // Our own "verification failed" already recorded the real reason (e.g.
    // name_mismatch); only genuine provider/network errors land below.
    if (e instanceof ValidationError) throw e;
    // Avoid leaking provider payloads or PII in errors
    await upsertUserVerification({
      userId: input.userId,
      bvnStatus: "FAILED",
      bvnFailureReason: "provider_error",
      bvnVerifiedAt: null,
      bvnSuffix: input.bvn.slice(-4),
      bvn: null,
    });
    throw new ValidationError("BVN verification failed");
  }
}

export async function submitNinVerification(input: {
  userId: string;
  nin: string;
}) {
  const existing = await getUserVerification(input.userId);
  if (existing?.ninStatus === "VERIFIED") {
    return getMyVerificationStatus(input.userId);
  }

  try {
    const resp = await monnifyNinVerification({ nin: input.nin });
    const code = (resp as any)?.responseCode;

    if (code !== "0") {
      await upsertUserVerification({
        userId: input.userId,
        ninStatus: "FAILED",
        ninFailureReason: `code_${code}`,
        ninVerifiedAt: null,
        ninSuffix: input.nin.slice(-4),
        nin: null,
      });
      throw new ValidationError("NIN verification failed");
    }

    const body = (resp as any)?.responseBody ?? {};
    await upsertUserVerification({
      userId: input.userId,
      ninStatus: "VERIFIED",
      ninVerifiedAt: new Date(),
      ninProviderReference: (body as any)?.transactionReference ?? null,
      ninFailureReason: null,
      ninSuffix: input.nin.slice(-4),
      nin: null,
    });

    return getMyVerificationStatus(input.userId);
  } catch (e) {
    if (e instanceof ValidationError) throw e;
    await upsertUserVerification({
      userId: input.userId,
      ninStatus: "FAILED",
      ninFailureReason: "provider_error",
      ninVerifiedAt: null,
      ninSuffix: input.nin.slice(-4),
      nin: null,
    });
    throw new ValidationError("NIN verification failed");
  }
}
