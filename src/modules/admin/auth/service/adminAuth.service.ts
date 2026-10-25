import bcrypt from "bcrypt";

import { env } from "../../../../core/config/env.js";
import { UnauthorizedError } from "../../../../core/errors/UnauthorizedError.js";
import { logger } from "../../../../core/logger/logger.js";
import { sha256Base64Url, randomToken } from "../../../../core/utils/crypto.js";
import { signAccessToken } from "../../../../core/auth/jwt.js";
import {
  findUserByEmailOrPhone,
  findUserById,
} from "../../../user/repository/user.repository.js";
import {
  createSession,
  findSessionById,
  deleteSessionById,
} from "../../../auth/repository/session.repository.js";
import { insertAuditLog } from "../../../audit/repository/audit.repository.js";

const ADMIN_ROLES = new Set(["super_admin", "business_admin", "finance_admin"]);

function parseRefreshToken(refreshToken: string): {
  sessionId: string;
  token: string;
} {
  const idx = refreshToken.indexOf(".");
  if (idx <= 0) throw new UnauthorizedError("Invalid session");
  const sessionId = refreshToken.slice(0, idx);
  const token = refreshToken.slice(idx + 1);
  if (!sessionId || !token) throw new UnauthorizedError("Invalid session");
  return { sessionId, token };
}

export async function adminLogin(input: {
  email?: string;
  phone?: string;
  password: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}) {
  const lookup: { email?: string; phone?: string } = {};
  if (input.email) lookup.email = input.email;
  if (input.phone) lookup.phone = input.phone;

  const user = await findUserByEmailOrPhone(lookup);
  if (!user || !ADMIN_ROLES.has(user.role) || user.status !== "active") {
    await insertAuditLog({
      actorAdminId: user?.id ?? null,
      actorRole: user?.role ?? null,
      action: "ADMIN_LOGIN_FAILED",
      targetType: "admin",
      targetId: user?.id ?? null,
      ip: input.ip,
      userAgent: input.userAgent,
      success: false,
      reason: "invalid_credentials_or_not_admin",
      requestId: input.requestId,
    });
    throw new UnauthorizedError("Invalid credentials");
  }

  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) {
    await insertAuditLog({
      actorAdminId: user.id,
      actorRole: user.role,
      action: "ADMIN_LOGIN_FAILED",
      targetType: "admin",
      targetId: user.id,
      ip: input.ip,
      userAgent: input.userAgent,
      success: false,
      reason: "invalid_credentials",
      requestId: input.requestId,
    });
    throw new UnauthorizedError("Invalid credentials");
  }

  const accessToken = signAccessToken({ sub: user.id, role: user.role });
  const rawRefreshToken = randomToken(32);
  const refreshTokenHash = sha256Base64Url(rawRefreshToken);
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000);

  const session = await createSession({
    userId: user.id,
    refreshTokenHash,
    expiresAt,
    sessionType: "admin",
  });
  const refreshToken = `${session.id}.${rawRefreshToken}`;

  await insertAuditLog({
    actorAdminId: user.id,
    actorRole: user.role,
    action: "ADMIN_LOGIN_SUCCESS",
    targetType: "admin",
    targetId: user.id,
    ip: input.ip,
    userAgent: input.userAgent,
    success: true,
    requestId: input.requestId,
  });

  logger.info({ adminId: user.id }, "admin_login");

  return {
    admin: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
    },
    accessToken,
    refreshToken,
    accessTokenExpiresInSeconds: env.JWT_ACCESS_TTL_SECONDS,
    refreshTokenExpiresInSeconds: env.REFRESH_TOKEN_TTL_SECONDS,
  };
}

export async function adminRefresh(input: {
  refreshToken: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}) {
  const { sessionId, token } = parseRefreshToken(input.refreshToken);
  const session = await findSessionById(sessionId);
  if (!session || session.sessionType !== "admin" || session.revoked)
    throw new UnauthorizedError("Invalid session");
  if (new Date(session.expiresAt).getTime() <= Date.now())
    throw new UnauthorizedError("Session expired");

  const tokenHash = sha256Base64Url(token);
  if (tokenHash !== session.refreshTokenHash)
    throw new UnauthorizedError("Invalid session");

  const user = await findUserById(session.userId);
  if (!user || !ADMIN_ROLES.has(user.role) || user.status !== "active")
    throw new UnauthorizedError("Invalid session");

  const accessToken = signAccessToken({ sub: session.userId, role: user.role });

  await insertAuditLog({
    actorAdminId: user.id,
    actorRole: user.role,
    action: "ADMIN_REFRESH",
    targetType: "admin",
    targetId: user.id,
    ip: input.ip,
    userAgent: input.userAgent,
    success: true,
    requestId: input.requestId,
  });

  return {
    accessToken,
    accessTokenExpiresInSeconds: env.JWT_ACCESS_TTL_SECONDS,
  };
}

export async function adminLogout(input: {
  refreshToken: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}) {
  const { sessionId } = parseRefreshToken(input.refreshToken);
  const session = await findSessionById(sessionId);
  if (session) await deleteSessionById(sessionId);
  await insertAuditLog({
    actorAdminId: session?.userId ?? null,
    actorRole: null,
    action: "ADMIN_LOGOUT",
    targetType: "admin",
    targetId: session?.userId ?? null,
    ip: input.ip,
    userAgent: input.userAgent,
    success: true,
    requestId: input.requestId,
  });
  return { success: true };
}

export async function adminMe(input: { userId: string }) {
  const user = await findUserById(input.userId);
  if (!user || !ADMIN_ROLES.has(user.role)) throw new UnauthorizedError();
  return {
    admin: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
    },
  };
}
