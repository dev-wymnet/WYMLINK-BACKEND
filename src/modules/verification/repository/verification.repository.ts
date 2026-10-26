import { eq, sql } from "drizzle-orm";

import { db } from "../../../core/db/client.js";
import { kycAttempts, kycProfiles, users } from "../../../core/db/schema.js";
import type { Executor } from "../../wallet/repository/wallet.repository.js";

export type KycProfile = typeof kycProfiles.$inferSelect;
export type KycStatus = "none" | "pending" | "verified" | "failed";

export async function getKycProfile(userId: string, ex: Executor = db) {
  const rows = await ex.select().from(kycProfiles).where(eq(kycProfiles.userId, userId)).limit(1);
  return rows[0] ?? null;
}

export async function upsertKycProfile(
  ex: Executor,
  userId: string,
  set: Partial<Omit<typeof kycProfiles.$inferInsert, "userId">>,
) {
  await ex
    .insert(kycProfiles)
    .values({ userId, ...set })
    .onConflictDoUpdate({ target: kycProfiles.userId, set });
}

export async function recordKycAttempt(input: {
  userId: string;
  kind: "bvn" | "nin" | "bvn_account_match";
  outcome: "started" | "otp_sent" | "verified" | "failed" | "error";
  provider: string;
  providerReference?: string | null;
  failureReason?: string | null;
}) {
  await db.insert(kycAttempts).values(input);
}

// Tier follows verified identities: 0 none, 1 BVN or NIN, 2 both.
// Tier 3 (full KYC) is only ever set by staff and never lowered here.
export async function syncKycTier(ex: Executor, userId: string) {
  await ex.execute(sql`
    update app.users u
       set kyc_tier = greatest(
             case when u.kyc_tier = 3 then 3 else 0 end,
             (select (case when k.bvn_status = 'verified' then 1 else 0 end)
                   + (case when k.nin_status = 'verified' then 1 else 0 end)
                from app.kyc_profiles k where k.user_id = u.id))
     where u.id = ${userId}::uuid
       and exists (select 1 from app.kyc_profiles k where k.user_id = u.id)`);
  const rows = await ex.select({ tier: users.kycTier }).from(users).where(eq(users.id, userId)).limit(1);
  return rows[0]?.tier ?? 0;
}
