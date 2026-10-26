import bcrypt from "bcrypt";

import { env } from "../../../../core/config/env.js";
import { UnauthorizedError } from "../../../../core/errors/UnauthorizedError.js";
import { logger } from "../../../../core/logger/logger.js";
import { randomToken } from "../../../../core/utils/crypto.js";
import { signAccessToken } from "../../../../core/auth/jwt.js";
import {
  findUserByEmailOrPhone,
  findUserById,
  touchLastLogin,
  type User,
} from "../../../user/repository/user.repository.js";
import { revokeSession, touchSession } from "../../../auth/repository/session.repository.js";
import { issueTokens, resolveSession } from "../../../auth/service/auth.service.js";
import { insertAuditLog } from "../../../audit/repository/audit.repository.js";

export const ADMIN_ROLES = new Set(["super_admin", "business_admin", "finance_admin"]);

// Staff sessions end after 8 hours regardless of activity.
const ADMIN_SESSION_SECONDS = 8 * 60 * 60;

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

export async function adminLogin(input: { email?: string | undefined; phone?: string | undefined; password: string } & RequestMeta) {
  const user = await findUserByEmailOrPhone({ email: input.email, phone: input.phone });
  const passwordOk = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);

  if (!isActiveAdmin(user) || !passwordOk) {
    await audit(input, {
      actor: user && ADMIN_ROLES.has(user.role) ? user : null,
      action: "ADMIN_LOGIN_FAILED",
      success: false,
      reason: !user || !ADMIN_ROLES.has(user.role) ? "not_admin" : user.status !== "active" ? "inactive" : "invalid_password",
    });
    throw new UnauthorizedError("Invalid credentials");
  }

  const tokens = await issueTokens(
    { userId: user.id, role: user.role },
    { kind: "admin", refreshTtlSeconds: ADMIN_SESSION_SECONDS, ip: input.ip ?? null, userAgent: input.userAgent ?? null },
  );
  await touchLastLogin(user.id);
  await audit(input, { actor: user, action: "ADMIN_LOGIN_SUCCESS", success: true });
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
  await touchSession(session.id);
  return {
    accessToken: signAccessToken({ sub: user.id, role: user.role }),
    accessTokenExpiresInSeconds: env.JWT_ACCESS_TTL_SECONDS,
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
  return { admin: toAdminDto(user) };
}
