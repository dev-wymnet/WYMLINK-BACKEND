import { and, eq } from "drizzle-orm";

import { db } from "../../../core/db/client.js";
import { userVerifications } from "../../../core/db/schema.js";

export async function getUserVerification(userId: string) {
  const rows = await db
    .select()
    .from(userVerifications)
    .where(eq(userVerifications.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertUserVerification(input: {
  userId: string;
  bvn?: string | null;
  bvnStatus?: "PENDING" | "VERIFIED" | "FAILED" | "REVOKED" | null;
  bvnVerifiedAt?: Date | null;
  bvnProviderReference?: string | null;
  bvnFailureReason?: string | null;
  bvnSuffix?: string | null;
  nin?: string | null;
  ninStatus?: "PENDING" | "VERIFIED" | "FAILED" | "REVOKED" | null;
  ninVerifiedAt?: Date | null;
  ninProviderReference?: string | null;
  ninFailureReason?: string | null;
  ninSuffix?: string | null;
}) {
  const existing = await getUserVerification(input.userId);
  if (existing) {
    const [updated] = await db
      .update(userVerifications)
      .set({
        bvn: input.bvn ?? existing.bvn,
        bvnStatus: input.bvnStatus ?? existing.bvnStatus,
        bvnVerifiedAt: input.bvnVerifiedAt ?? existing.bvnVerifiedAt,
        bvnProviderReference:
          input.bvnProviderReference ?? existing.bvnProviderReference,
        bvnFailureReason: input.bvnFailureReason ?? existing.bvnFailureReason,
        bvnSuffix: input.bvnSuffix ?? existing.bvnSuffix,
        nin: input.nin ?? existing.nin,
        ninStatus: input.ninStatus ?? existing.ninStatus,
        ninVerifiedAt: input.ninVerifiedAt ?? existing.ninVerifiedAt,
        ninProviderReference:
          input.ninProviderReference ?? existing.ninProviderReference,
        ninFailureReason: input.ninFailureReason ?? existing.ninFailureReason,
        ninSuffix: input.ninSuffix ?? existing.ninSuffix,
      })
      .where(eq(userVerifications.id, existing.id))
      .returning();
    return updated ?? null;
  }

  const [inserted] = await db
    .insert(userVerifications)
    .values({
      userId: input.userId,
      bvn: input.bvn ?? null,
      bvnStatus: input.bvnStatus ?? "PENDING",
      bvnVerifiedAt: input.bvnVerifiedAt ?? null,
      bvnProviderReference: input.bvnProviderReference ?? null,
      bvnFailureReason: input.bvnFailureReason ?? null,
      bvnSuffix: input.bvnSuffix ?? null,
      nin: input.nin ?? null,
      ninStatus: input.ninStatus ?? "PENDING",
      ninVerifiedAt: input.ninVerifiedAt ?? null,
      ninProviderReference: input.ninProviderReference ?? null,
      ninFailureReason: input.ninFailureReason ?? null,
      ninSuffix: input.ninSuffix ?? null,
    })
    .returning();
  return inserted ?? null;
}
