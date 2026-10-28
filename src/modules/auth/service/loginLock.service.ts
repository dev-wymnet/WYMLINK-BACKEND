import { and, gt, inArray, sql } from "drizzle-orm";

import { db } from "../../../core/db/client.js";
import { loginAttempts } from "../../../core/db/schema.js";
import { LoginLockedError } from "../../../core/errors/AppError.js";
import { sha256Base64Url } from "../../../core/utils/crypto.js";
import { normalizeEmail, normalizePhone } from "../../../core/utils/identity.js";

// Per-account sign-in lockout, on top of the per-IP rate limits (which a guesser spreading
// attempts over many IPs gets around). `max` wrong attempts within `lockSeconds` lock the
// account for `lockSeconds`; each lockout in a row doubles the next (up to 16x, forgotten
// after a day without failures), and a successful sign-in clears it.
//
// Failures count against every key the attempt touches: the email typed, the phone typed
// and, when it exists, the account. So unknown accounts lock exactly like real ones (no
// account discovery) and switching between email and phone doesn't buy extra guesses.
export type LoginScope = "customer" | "admin";

const POLICY: Record<LoginScope, { max: number; lockSeconds: number }> = {
  customer: { max: 5, lockSeconds: 15 * 60 },
  admin: { max: 5, lockSeconds: 30 * 60 },
};

const safePhone = (phone: string) => {
  try {
    return normalizePhone(phone);
  } catch {
    return phone.replace(/\s+/g, "");
  }
};

export function loginKeys(
  scope: LoginScope,
  input: { email?: string | undefined; phone?: string | undefined; userId?: string | undefined },
): string[] {
  const parts = [
    input.email ? `email:${normalizeEmail(input.email)}` : null,
    input.phone ? `phone:${safePhone(input.phone)}` : null,
    input.userId ? `user:${input.userId}` : null,
  ];
  return parts.filter((p): p is string => Boolean(p)).map((p) => sha256Base64Url(`login:${scope}:${p}`));
}

export async function assertLoginAllowed(scope: LoginScope, keys: string[]) {
  if (!keys.length) return;
  const rows = await db
    .select({ lockedUntil: loginAttempts.lockedUntil })
    .from(loginAttempts)
    .where(and(inArray(loginAttempts.key, keys), gt(loginAttempts.lockedUntil, sql`now()`)));
  const until = rows.reduce<Date | null>((max, r) => (r.lockedUntil && (!max || r.lockedUntil > max) ? r.lockedUntil : max), null);
  // Customers can lift a lock by resetting their password; staff ask a super admin.
  if (until) throw new LoginLockedError(until, scope === "customer");
}

// One atomic upsert per key: concurrent guesses can't race past the limit.
export async function registerLoginFailure(scope: LoginScope, keys: string[]) {
  const { max, lockSeconds } = POLICY[scope];
  const recent = sql`${loginAttempts.lastFailedAt} > now() - make_interval(secs => ${lockSeconds})`;
  const count = sql`(case when ${recent} then ${loginAttempts.failedAttempts} else 0 end) + 1`;
  const streak = sql`(case when ${loginAttempts.lastFailedAt} > now() - interval '24 hours' then ${loginAttempts.lockouts} else 0 end)`;
  const locks = sql`${count} >= ${max}`;
  for (const key of keys) {
    await db
      .insert(loginAttempts)
      .values({ key, failedAttempts: 1, lastFailedAt: sql`now()` })
      .onConflictDoUpdate({
        target: loginAttempts.key,
        set: {
          failedAttempts: sql`case when ${locks} then 0 else ${count} end`,
          lockouts: sql`case when ${locks} then ${streak} + 1 else ${streak} end`,
          lockedUntil: sql`case when ${locks} then now() + make_interval(secs => ${lockSeconds} * power(2, least(${streak}, 4))) else ${loginAttempts.lockedUntil} end`,
          lastFailedAt: sql`now()`,
        },
      });
  }
}

export async function clearLoginFailures(keys: string[]) {
  if (keys.length) await db.delete(loginAttempts).where(inArray(loginAttempts.key, keys));
}
