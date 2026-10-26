import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";

import { env } from "../../../core/config/env.js";
import { db } from "../../../core/db/client.js";
import { users } from "../../../core/db/schema.js";
import { UnauthorizedError } from "../../../core/errors/UnauthorizedError.js";
import { ValidationError } from "../../../core/errors/ValidationError.js";
import { AccountInactiveError, InvalidCodeError } from "../../../core/errors/AppError.js";
import { logger } from "../../../core/logger/logger.js";
import { sha256Base64Url, randomToken } from "../../../core/utils/crypto.js";
import { signAccessToken } from "../../../core/auth/jwt.js";
import { sendEmail } from "../../../core/email/mailer.js";

import {
  createUser,
  findContactConflict,
  findUserByEmailOrPhone,
  findUserById,
  touchLastLogin,
} from "../../user/repository/user.repository.js";
import {
  CUSTOMER_SESSION_KINDS,
  createSession,
  findSessionById,
  revokeSession,
  revokeUserSessions,
  touchSession,
  type SessionKind,
} from "../repository/session.repository.js";
import { getOrCreateWallet } from "../../wallet/repository/wallet.repository.js";
import { consumeOtp, issueOtp, quietly } from "./otp.service.js";

// bcrypt hash of a random throwaway string, used to equalise login timing.
const DUMMY_HASH = bcrypt.hashSync(randomToken(16), 12);

export type ClientContext = {
  client?: "web" | "mobile" | undefined;
  deviceId?: string | null | undefined;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
};

function parseRefreshToken(refreshToken: string) {
  const idx = refreshToken.indexOf(".");
  const sessionId = idx > 0 ? refreshToken.slice(0, idx) : "";
  const token = idx > 0 ? refreshToken.slice(idx + 1) : "";
  if (!/^[0-9a-f-]{36}$/i.test(sessionId) || !token) throw new UnauthorizedError("Invalid session");
  return { sessionId, token };
}

const isUniqueViolation = (err: any) => (err?.code ?? err?.cause?.code) === "23505";

export async function signup(
  input: { firstName: string; lastName: string; email?: string | undefined; phone?: string | undefined; password: string },
  ctx: ClientContext = {},
) {
  if (await findContactConflict({ email: input.email, phone: input.phone })) {
    throw new ValidationError("An account with this email or phone number already exists");
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  let userId: string;
  let role: string;
  try {
    // User and wallet are created together or not at all.
    ({ id: userId, role } = await db.transaction(async (tx) => {
      const user = await createUser(tx, {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email ?? null,
        phone: input.phone ?? null,
        passwordHash,
      });
      await getOrCreateWallet(user.id, tx);
      return user;
    }));
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ValidationError("An account with this email or phone number already exists");
    }
    throw err;
  }

  logger.info({ userId }, "auth_signup");
  return issueTokens({ userId, role }, ctx);
}

export async function login(
  input: { email?: string | undefined; phone?: string | undefined; password: string },
  ctx: ClientContext = {},
) {
  const user = await findUserByEmailOrPhone({ email: input.email, phone: input.phone });
  if (!user) {
    // Spend the same time as a real check so response timing doesn't reveal which accounts exist.
    await bcrypt.compare(input.password, DUMMY_HASH);
    throw new UnauthorizedError("Invalid credentials");
  }

  if (!(await bcrypt.compare(input.password, user.passwordHash))) {
    throw new UnauthorizedError("Invalid credentials");
  }
  if (user.status !== "active") throw new AccountInactiveError();
  // Staff accounts sign in through the admin console only.
  if (user.role !== "customer") throw new UnauthorizedError("Invalid credentials");

  await touchLastLogin(user.id);
  logger.info({ userId: user.id }, "auth_login");
  return issueTokens({ userId: user.id, role: user.role }, ctx);
}

export async function issueTokens(
  input: { userId: string; role: string },
  ctx: ClientContext & { kind?: SessionKind; refreshTtlSeconds?: number } = {},
) {
  const rawRefreshToken = randomToken(32);
  const kind = ctx.kind ?? (ctx.client === "mobile" ? "mobile" : "web");
  // Phones keep a longer session: the app asks for its passcode on every open.
  const refreshTtl = ctx.refreshTtlSeconds ?? (kind === "mobile" ? env.MOBILE_REFRESH_TOKEN_TTL_SECONDS : env.REFRESH_TOKEN_TTL_SECONDS);
  const session = await createSession({
    userId: input.userId,
    kind,
    refreshTokenHash: sha256Base64Url(rawRefreshToken),
    expiresAt: new Date(Date.now() + refreshTtl * 1000),
    deviceId: ctx.deviceId ?? null,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
  });

  return {
    user: { id: input.userId, role: input.role },
    accessToken: signAccessToken({ sub: input.userId, role: input.role }),
    refreshToken: `${session.id}.${rawRefreshToken}`,
    accessTokenExpiresInSeconds: env.JWT_ACCESS_TTL_SECONDS,
    refreshTokenExpiresInSeconds: refreshTtl,
  };
}

// Validates a refresh token against an open session of one of `kinds`.
export async function resolveSession(refreshToken: string, kinds: SessionKind[]) {
  const { sessionId, token } = parseRefreshToken(refreshToken);
  const session = await findSessionById(sessionId);
  if (!session || session.revokedAt || !kinds.includes(session.kind as SessionKind)) {
    throw new UnauthorizedError("Invalid session");
  }
  if (session.expiresAt.getTime() <= Date.now()) {
    await revokeSession(session.id, "expired");
    throw new UnauthorizedError("Session expired");
  }
  if (sha256Base64Url(token) !== session.refreshTokenHash) throw new UnauthorizedError("Invalid session");
  return session;
}

export async function refreshAccessToken(input: { refreshToken: string }) {
  const session = await resolveSession(input.refreshToken, CUSTOMER_SESSION_KINDS);
  const user = await findUserById(session.userId);
  if (!user || user.status !== "active") {
    await revokeSession(session.id, "account_inactive");
    throw new UnauthorizedError("Invalid session");
  }
  await touchSession(session.id);
  logger.info({ userId: session.userId, sessionId: session.id }, "auth_refresh");
  return {
    accessToken: signAccessToken({ sub: session.userId, role: user.role }),
    accessTokenExpiresInSeconds: env.JWT_ACCESS_TTL_SECONDS,
  };
}

export async function logout(input: { refreshToken: string }) {
  try {
    const { sessionId } = parseRefreshToken(input.refreshToken);
    await revokeSession(sessionId, "logout");
    logger.info({ sessionId }, "auth_logout");
  } catch {
    // Logging out with a bad token is a no-op.
  }
}

// Same answer whether or not the email exists (no account discovery).
export async function requestPasswordReset(input: { email: string }) {
  const user = await findUserByEmailOrPhone({ email: input.email });
  if (!user?.email || user.role !== "customer") return;
  const { id, email } = user;
  await quietly(id, "reset_password", async () => {
    const { code, minutes } = await issueOtp(id, "reset_password");
    await sendEmail({
      to: email,
      subject: "Your Wymlink password reset code",
      text: `Use this code to reset your password: ${code}. It expires in ${minutes} minutes.`,
      html: `<p>Use this code to reset your password:</p><h2 style="letter-spacing:4px">${code}</h2><p>This code expires in ${minutes} minutes.</p>`,
    });
  });
}

export async function resetPasswordWithOtp(input: { email: string; code: string; newPassword: string }) {
  if (input.newPassword.length < 8) throw new ValidationError("Password is too short");
  const user = await findUserByEmailOrPhone({ email: input.email });
  if (!user?.email || user.role !== "customer") throw new InvalidCodeError();

  await consumeOtp(user.id, "reset_password", input.code);
  const passwordHash = await bcrypt.hash(input.newPassword, 12);
  await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));

  // A password reset signs out every device.
  await revokeUserSessions({ userId: user.id, kinds: CUSTOMER_SESSION_KINDS, reason: "password_reset" });
  logger.info({ userId: user.id }, "auth_password_reset_sessions_revoked");
}
