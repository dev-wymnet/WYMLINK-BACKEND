import bcrypt from "bcrypt";
import { timingSafeEqual } from "node:crypto";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import { config } from "../../../../core/config/index.js";
import { db } from "../../../../core/db/client.js";
import { adminMfa, adminMfaChallenges, users } from "../../../../core/db/schema.js";
import { UnauthorizedError } from "../../../../core/errors/UnauthorizedError.js";
import { ValidationError } from "../../../../core/errors/ValidationError.js";
import { InvalidCodeError } from "../../../../core/errors/AppError.js";
import { logger } from "../../../../core/logger/logger.js";
import { randomToken, sha256Base64Url } from "../../../../core/utils/crypto.js";
import { seal, unseal } from "../../../../core/utils/seal.js";
import { signAccessToken } from "../../../../core/auth/jwt.js";
import { ADMIN_IDLE_MS } from "../../../../core/auth/sessionState.js";
import { matchTotp, newTotpSecret, otpauthUrl } from "../../../../core/auth/totp.js";
import { sendEmail } from "../../../../core/email/mailer.js";
import {
  findUserByEmailOrPhone,
  findUserById,
  touchLastLogin,
  type User,
} from "../../../user/repository/user.repository.js";
import { revokeSession, revokeUserSessions, touchSession } from "../../../auth/repository/session.repository.js";
import { issueTokens, resolveSession } from "../../../auth/service/auth.service.js";
import { assertLoginAllowed, clearLoginFailures, loginKeys, registerLoginFailure } from "../../../auth/service/loginLock.service.js";
import { insertAuditLog } from "../../../audit/repository/audit.repository.js";

export const ADMIN_ROLES = new Set(["super_admin", "business_admin", "finance_admin"]);

// Staff sessions: 10-minute access tokens, ended after 30 idle minutes (ADMIN_IDLE_MS)
// and after 8 hours regardless.
const ADMIN_SESSION_SECONDS = 8 * 60 * 60;
const ADMIN_ACCESS_SECONDS = 10 * 60;

// Sign-in is two steps: the password, then a code from the staff member's authenticator
// app, within 5 minutes and 5 tries. Wrong codes also count towards the account lockout.
const CHALLENGE_SECONDS = 5 * 60;
const CHALLENGE_TRIES = 5;

const DUMMY_HASH = bcrypt.hashSync(randomToken(16), 12);

type RequestMeta = { ip?: string | undefined; userAgent?: string | undefined; requestId?: string | undefined };

const audit = (meta: RequestMeta, entry: { actor: User | null; action: string; success: boolean; reason?: string }) =>
  insertAuditLog({
    actorUserId: entry.actor?.id ?? null,
    actorRole: entry.actor?.role ?? null,
    action: entry.action,
    targetType: "admin",
    targetId: entry.actor?.id ?? null,
    success: entry.success,
    reason: entry.reason ?? null,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
    requestId: meta.requestId ?? null,
  });

const toAdminDto = (u: User) => ({
  id: u.id,
  firstName: u.firstName,
  lastName: u.lastName,
  email: u.email,
  phone: u.phone,
  role: u.role,
  status: u.status,
});

const isActiveAdmin = (u: User | null): u is User => Boolean(u && ADMIN_ROLES.has(u.role) && u.status === "active");

const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function authenticator(userId: string) {
  const rows = await db.select().from(adminMfa).where(eq(adminMfa.userId, userId)).limit(1);
  return rows[0] ?? null;
}

// Security notices go to the staff member's own inbox; a mail failure never blocks sign-in.
function notify(user: User, subject: string, text: string) {
  if (!user.email) return;
  sendEmail({ to: user.email, subject, text, html: `<p>${text}</p>` }).catch((err) =>
    logger.warn({ adminId: user.id, err: (err as Error).message }, "admin_security_email_failed"),
  );
}

// Step 1: the password. Right → a single-use challenge for the authenticator step and,
// for staff without an authenticator yet, a new secret to add to one.
export async function adminLogin(input: { email?: string | undefined; phone?: string | undefined; password: string } & RequestMeta) {
  const user = await findUserByEmailOrPhone({ email: input.email, phone: input.phone });
  const keys = loginKeys("admin", { email: input.email, phone: input.phone, userId: user?.id });
  await assertLoginAllowed("admin", keys);
  const passwordOk = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);

  if (!isActiveAdmin(user) || !passwordOk) {
    await registerLoginFailure("admin", keys);
    await audit(input, {
      actor: user && ADMIN_ROLES.has(user.role) ? user : null,
      action: "ADMIN_LOGIN_FAILED",
      success: false,
      reason: !user || !ADMIN_ROLES.has(user.role) ? "not_admin" : user.status !== "active" ? "inactive" : "invalid_password",
    });
    throw new UnauthorizedError("Invalid credentials");
  }

  // Two-step sign-in switched off (ADMIN_MFA_REQUIRED=false): the password alone signs in.
  if (!config.ADMIN_MFA_REQUIRED) {
    logger.warn({ adminId: user.id }, "admin_login_without_mfa");
    return startAdminSession(user, keys, input, "mfa_switched_off");
  }

  const enrolled = Boolean(await authenticator(user.id));
  const secret = enrolled ? null : newTotpSecret();
  const raw = randomToken(32);
  await db.delete(adminMfaChallenges).where(and(eq(adminMfaChallenges.userId, user.id), lt(adminMfaChallenges.expiresAt, sql`now() - interval '1 day'`)));
  const [challenge] = await db
    .insert(adminMfaChallenges)
    .values({
      userId: user.id,
      tokenHash: sha256Base64Url(raw),
      lockKeys: keys.join(" "),
      enrollSealed: secret ? seal(secret) : null,
      expiresAt: new Date(Date.now() + CHALLENGE_SECONDS * 1000),
    })
    .returning({ id: adminMfaChallenges.id });
  await audit(input, { actor: user, action: "ADMIN_PASSWORD_ACCEPTED", success: true });

  return {
    mfaRequired: true,
    mfaToken: `${challenge!.id}.${raw}`,
    mfaExpiresInSeconds: CHALLENGE_SECONDS,
    enrollment: secret ? { secret, otpauthUrl: otpauthUrl(secret, user.email ?? user.id) } : null,
  };
}

// Step 2: the authenticator code. Right → the staff session. For staff enrolling, the
// first right code for the challenge's secret makes it their authenticator.
export async function adminVerifyMfa(input: { mfaToken: string; code: string } & RequestMeta) {
  const expired = () => new UnauthorizedError("This sign-in has expired. Enter your password again.");
  const dot = input.mfaToken.indexOf(".");
  const id = dot > 0 ? input.mfaToken.slice(0, dot) : "";
  const raw = dot > 0 ? input.mfaToken.slice(dot + 1) : "";
  if (!/^[0-9a-f-]{36}$/i.test(id) || !raw) throw expired();

  const challenge = (await db.select().from(adminMfaChallenges).where(eq(adminMfaChallenges.id, id)).limit(1))[0];
  if (
    !challenge ||
    challenge.usedAt ||
    challenge.expiresAt.getTime() <= Date.now() ||
    challenge.attempts >= CHALLENGE_TRIES ||
    !sameHash(sha256Base64Url(raw), challenge.tokenHash)
  ) {
    throw expired();
  }
  const keys = challenge.lockKeys.split(" ");
  await assertLoginAllowed("admin", keys);
  const user = await findUserById(challenge.userId);
  if (!isActiveAdmin(user)) throw expired();

  const saved = await authenticator(user.id);
  const sealed = saved?.secretSealed ?? challenge.enrollSealed;
  if (!sealed) throw expired();
  const step = matchTotp(unseal(sealed), input.code.trim(), saved?.lastStep ?? null);
  if (step === null) {
    await db.update(adminMfaChallenges).set({ attempts: sql`${adminMfaChallenges.attempts} + 1` }).where(eq(adminMfaChallenges.id, challenge.id));
    await registerLoginFailure("admin", keys);
    await audit(input, { actor: user, action: "ADMIN_MFA_FAILED", success: false });
    throw new InvalidCodeError("That code isn't right. Check the Wymlink entry in your authenticator app and try again.");
  }

  // Single use: a second request with this challenge loses the race here.
  const claimed = await db
    .update(adminMfaChallenges)
    .set({ usedAt: new Date() })
    .where(and(eq(adminMfaChallenges.id, challenge.id), isNull(adminMfaChallenges.usedAt)))
    .returning({ id: adminMfaChallenges.id });
  if (!claimed.length) throw expired();

  if (saved) {
    // Each code works once, even inside its 30 seconds.
    const fresh = await db
      .update(adminMfa)
      .set({ lastStep: step })
      .where(and(eq(adminMfa.userId, user.id), or(isNull(adminMfa.lastStep), lt(adminMfa.lastStep, step))))
      .returning({ userId: adminMfa.userId });
    if (!fresh.length) throw new InvalidCodeError("That code was already used. Wait for the next one and sign in again.");
  } else {
    const enrolled = await db
      .insert(adminMfa)
      .values({ userId: user.id, secretSealed: challenge.enrollSealed!, lastStep: step })
      .onConflictDoNothing()
      .returning({ userId: adminMfa.userId });
    if (!enrolled.length) throw expired();
    await audit(input, { actor: user, action: "ADMIN_MFA_ENROLLED", success: true });
    notify(
      user,
      "Two-step sign-in is on for your Wymlink admin account",
      "An authenticator app was just added to your Wymlink admin account. If this wasn't you, tell a super admin straight away so they can reset it.",
    );
  }

  return startAdminSession(user, keys, input);
}

// The staff session, once sign-in is complete. `reason` marks sign-ins that skipped the
// authenticator step in the audit log.
async function startAdminSession(user: User, keys: string[], input: RequestMeta, reason?: string) {
  await clearLoginFailures(keys);
  const tokens = await issueTokens(
    { userId: user.id, role: user.role },
    {
      kind: "admin",
      refreshTtlSeconds: ADMIN_SESSION_SECONDS,
      accessTtlSeconds: ADMIN_ACCESS_SECONDS,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    },
  );
  await touchLastLogin(user.id);
  await audit(input, { actor: user, action: "ADMIN_LOGIN_SUCCESS", success: true, ...(reason ? { reason } : {}) });
  logger.info({ adminId: user.id }, "admin_login");

  return { ...tokens, admin: toAdminDto(user) };
}

export async function adminRefresh(input: { refreshToken: string } & RequestMeta) {
  const session = await resolveSession(input.refreshToken, ["admin"]);
  const user = await findUserById(session.userId);
  if (!isActiveAdmin(user)) {
    await revokeSession(session.id, "admin_inactive");
    throw new UnauthorizedError("Invalid session");
  }
  if (Date.now() - session.lastUsedAt.getTime() > ADMIN_IDLE_MS) {
    await revokeSession(session.id, "idle");
    throw new UnauthorizedError("Invalid session");
  }
  await touchSession(session.id);
  return {
    accessToken: signAccessToken({ sub: user.id, role: user.role, sid: session.id }, ADMIN_ACCESS_SECONDS),
    accessTokenExpiresInSeconds: ADMIN_ACCESS_SECONDS,
  };
}

export async function adminLogout(input: { refreshToken: string } & RequestMeta) {
  try {
    const session = await resolveSession(input.refreshToken, ["admin"]);
    await revokeSession(session.id, "logout");
    await audit(input, { actor: await findUserById(session.userId), action: "ADMIN_LOGOUT", success: true });
  } catch {
    // Logging out with a bad or expired token is a no-op.
  }
  return { success: true };
}

export async function adminMe(input: { userId: string }) {
  const user = await findUserById(input.userId);
  if (!isActiveAdmin(user)) throw new UnauthorizedError();
  return {
    admin: toAdminDto(user),
    mustChangePassword: user.mustChangePassword,
    mfaEnrolled: Boolean(await authenticator(user.id)),
    mfaRequired: config.ADMIN_MFA_REQUIRED,
  };
}

// Ends every other staff session for the account; the one making the change carries on.
export async function adminChangePassword(
  input: { userId: string; sessionId: string; currentPassword: string; newPassword: string } & RequestMeta,
) {
  const user = await findUserById(input.userId);
  if (!isActiveAdmin(user)) throw new UnauthorizedError();
  if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
    await audit(input, { actor: user, action: "ADMIN_PASSWORD_CHANGE_FAILED", success: false, reason: "invalid_password" });
    throw new ValidationError("Your current password isn't right.");
  }
  if (input.newPassword === input.currentPassword) throw new ValidationError("Choose a new password, not the one you have now.");

  await db
    .update(users)
    .set({ passwordHash: await bcrypt.hash(input.newPassword, 12), mustChangePassword: false })
    .where(eq(users.id, user.id));
  await revokeUserSessions({ userId: user.id, kinds: ["admin"], reason: "password_changed", exceptSessionId: input.sessionId });
  await audit(input, { actor: user, action: "ADMIN_PASSWORD_CHANGED", success: true });
  notify(
    user,
    "Your Wymlink admin password was changed",
    "The password for your Wymlink admin account was just changed, and every other signed-in session was ended. If this wasn't you, tell a super admin straight away.",
  );
  return { success: true };
}
