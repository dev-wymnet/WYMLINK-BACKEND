import bcrypt from "bcrypt";
import { and, eq } from "drizzle-orm";

import { db } from "../core/db/client.js";
import { pool } from "../core/db/pool.js";
import { users } from "../core/db/schema.js";
import { logger } from "../core/logger/logger.js";
import { insertAuditLog } from "../modules/audit/repository/audit.repository.js";
import { createUser, findContactConflict } from "../modules/user/repository/user.repository.js";

// Creates the FIRST super admin, so the admin console can be used at all (every other
// staff account is created from the console). Refuses if a super admin already exists.
//
//   ADMIN_EMAIL=you@wymnet.org ADMIN_FIRST_NAME=Ada ADMIN_LAST_NAME=Obi ADMIN_PASSWORD='…' npm run admin:create
//
// Run it once, with DATABASE_URL pointing at the database, then sign in to the console.
async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const firstName = process.env.ADMIN_FIRST_NAME?.trim();
  const lastName = process.env.ADMIN_LAST_NAME?.trim();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !firstName || !lastName) {
    throw new Error("Set ADMIN_EMAIL, ADMIN_FIRST_NAME and ADMIN_LAST_NAME");
  }
  if (password.length < 12) throw new Error("ADMIN_PASSWORD must be at least 12 characters");

  const existing = await db.select({ id: users.id }).from(users).where(and(eq(users.role, "super_admin"), eq(users.status, "active"))).limit(1);
  if (existing.length) throw new Error("A super admin already exists. Create more staff from the admin console.");
  if (await findContactConflict({ email })) throw new Error("An account with this email already exists");

  const user = await createUser(db, { firstName, lastName, email, phone: null, passwordHash: await bcrypt.hash(password, 12), role: "super_admin" });
  await insertAuditLog({ actorUserId: null, actorRole: "system", action: "SUPER_ADMIN_BOOTSTRAPPED", targetType: "admin", targetId: user.id, success: true });
  logger.info({ adminId: user.id }, "super_admin_created");
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    const e = err as Error & { cause?: Error };
    // The cause, not the query text (which carries the parameters).
    logger.error({ err: e.cause?.message ?? e.message }, "super_admin_create_failed");
    process.exit(1);
  });
