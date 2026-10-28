import { eq } from "drizzle-orm";

import { db } from "../core/db/client.js";
import { pool } from "../core/db/pool.js";
import { adminMfa, loginAttempts, users } from "../core/db/schema.js";
import { logger } from "../core/logger/logger.js";
import { insertAuditLog } from "../modules/audit/repository/audit.repository.js";
import { revokeUserSessions } from "../modules/auth/repository/session.repository.js";
import { loginKeys } from "../modules/auth/service/loginLock.service.js";

// Recovery for a staff member who lost their authenticator app and has no other super
// admin to reset it from the console (e.g. the only super admin). Removes their
// authenticator, ends their sessions and lifts a sign-in lockout; they set up a new
// authenticator at their next sign-in.
//
//   ADMIN_EMAIL=you@wymnet.org npm run admin:reset-mfa          (from a checkout)
//   ADMIN_EMAIL=you@wymnet.org node dist/scripts/resetAdminMfa.js  (on the server)
async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error("Set ADMIN_EMAIL");
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || user.role === "customer") throw new Error("No staff account with that email");

  await db.delete(adminMfa).where(eq(adminMfa.userId, user.id));
  await revokeUserSessions({ userId: user.id, kinds: ["admin"], reason: "mfa_reset" });
  for (const key of loginKeys("admin", { email, phone: user.phone ?? undefined, userId: user.id })) {
    await db.delete(loginAttempts).where(eq(loginAttempts.key, key));
  }
  await insertAuditLog({ actorUserId: null, actorRole: "system", action: "ADMIN_MFA_RESET", targetType: "admin", targetId: user.id, success: true });
  logger.info({ adminId: user.id }, "admin_mfa_reset");
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    const e = err as Error & { cause?: Error };
    // The cause, not the query text (which carries the parameters).
    logger.error({ err: e.cause?.message ?? e.message }, "admin_mfa_reset_failed");
    process.exit(1);
  });
