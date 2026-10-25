import bcrypt from "bcrypt";
import { randomInt } from "crypto";

import { env } from "../../../core/config/env.js";
import { UnauthorizedError } from "../../../core/errors/UnauthorizedError.js";
import { ValidationError } from "../../../core/errors/ValidationError.js";
import { AccountInactiveError, InvalidCodeError } from "../../../core/errors/AppError.js";
import { logger } from "../../../core/logger/logger.js";
import { sha256Base64Url, randomToken } from "../../../core/utils/crypto.js";
import { signAccessToken } from "../../../core/auth/jwt.js";

import {
  createUser,
  deleteUserById,
  ensureNoDuplicateUser,
  findUserByEmailOrPhone,
  findUserById,
} from "../../user/repository/user.repository.js";
import {
  createSession,
  deleteSessionById,
  findSessionById,
  revokeUserSessionsByType,
} from "../repository/session.repository.js";
import { findEnabledCountryByCode } from "../../country/repository/country.repository.js";
import { createWalletAndReservedAccount } from "../../wallet/service/wallet.service.js";
import { resolveRegionForCountry } from "../../geolocation/service/geolocation.service.js";
import { db } from "../../../core/db/client.js";
import { otpRequests, users } from "../../../core/db/schema.js";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { sendEmail } from "../../../core/email/mailer.js";

// bcrypt hash of a random throwaway string, used to equalise login timing.
const DUMMY_HASH = bcrypt.hashSync(randomToken(16), 12);

function parseRefreshToken(refreshToken: string): {
  sessionId: string;
  token: string;
} {
  const idx = refreshToken.indexOf(".");
  if (idx <= 0) throw new ValidationError("Invalid refresh token");

  const sessionId = refreshToken.slice(0, idx);
  const token = refreshToken.slice(idx + 1);
  if (!sessionId || !token) throw new ValidationError("Invalid refresh token");

  return { sessionId, token };
}

export async function signup(input: {
  firstName: string;
  lastName: string;
  countryCode: string;
  email?: string;
  phone?: string;
  password: string;
}) {
  const duplicateCheck: { email?: string; phone?: string } = {};
  if (input.email) duplicateCheck.email = input.email;
  if (input.phone) duplicateCheck.phone = input.phone;

  const existing = await ensureNoDuplicateUser(duplicateCheck);
  if (existing) throw new ValidationError("User already exists");

  const country = await findEnabledCountryByCode(input.countryCode);
  if (!country) throw new ValidationError("Unsupported country");

  const regionInfo = await resolveRegionForCountry({
    countryCode: country.code,
  });

  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await createUser({
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email ?? null,
    phone: input.phone ?? null,
    passwordHash,
    countryCode: country.code,
    currencyCode: country.currencyCode,
    region: regionInfo?.region ?? null,
    preferredCurrency: regionInfo?.preferredCurrency ?? country.currencyCode,
    complianceRegion: regionInfo?.complianceRegion ?? null,
    dataLocalizationRegion: regionInfo?.complianceRegion ?? null,
    complianceTier: "tier_1",
  });

  try {
    await createWalletAndReservedAccount({
      userId: user.id,
      currencyCode: user.currencyCode,
    });
  } catch (error) {
    await deleteUserById(user.id);

    logger.warn(
      { userId: user.id, email: user.email, err: error },
      "auth_signup_rolled_back",
    );

    throw error;
  }

  logger.info({ userId: user.id }, "auth_signup");

  return issueTokensForUser({ userId: user.id, role: user.role });
}

export async function login(input: {
  email?: string;
  phone?: string;
  password: string;
}) {
  const lookup: { email?: string; phone?: string } = {};
  if (input.email) lookup.email = input.email;
  if (input.phone) lookup.phone = input.phone;

  const user = await findUserByEmailOrPhone(lookup);
  if (!user) {
    // Spend the same time as a real check so response timing doesn't reveal which accounts exist.
    await bcrypt.compare(input.password, DUMMY_HASH);
    throw new UnauthorizedError("Invalid credentials");
  }

  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) throw new UnauthorizedError("Invalid credentials");

  if (user.status && user.status !== "active") {
    throw new AccountInactiveError();
  }

  logger.info({ userId: user.id }, "auth_login");

  return issueTokensForUser({ userId: user.id, role: user.role });
}

async function issueTokensForUser(input: {
  userId: string;
  role: string;
  sessionType?: "customer" | "admin";
}) {
  const accessToken = signAccessToken({ sub: input.userId, role: input.role });

  const rawRefreshToken = randomToken(32);
  const refreshTokenHash = sha256Base64Url(rawRefreshToken);

  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000);
  const session = await createSession({
    userId: input.userId,
    refreshTokenHash,
    expiresAt,
    sessionType: input.sessionType ?? "customer",
  });

  const refreshToken = `${session.id}.${rawRefreshToken}`;

  return {
    user: { id: input.userId, role: input.role },
    accessToken,
    refreshToken,
    accessTokenExpiresInSeconds: env.JWT_ACCESS_TTL_SECONDS,
    refreshTokenExpiresInSeconds: env.REFRESH_TOKEN_TTL_SECONDS,
  };
}

export async function refreshAccessToken(input: { refreshToken: string }) {
  const { sessionId, token } = parseRefreshToken(input.refreshToken);
  const session = await findSessionById(sessionId);
  if (!session) throw new UnauthorizedError("Invalid session");

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    await deleteSessionById(sessionId);
    throw new UnauthorizedError("Session expired");
  }

  const tokenHash = sha256Base64Url(token);
  if (tokenHash !== session.refreshTokenHash)
    throw new UnauthorizedError("Invalid session");

  if ((session as any).revoked) throw new UnauthorizedError("Invalid session");

  const user = await findUserById(session.userId);
  if (!user || (user.status && user.status !== "active")) {
    await deleteSessionById(sessionId);
    throw new UnauthorizedError("Invalid session");
  }

  const accessToken = signAccessToken({ sub: session.userId, role: user.role });

  logger.info({ userId: session.userId, sessionId }, "auth_refresh");

  return {
    accessToken,
    accessTokenExpiresInSeconds: env.JWT_ACCESS_TTL_SECONDS,
  };
}

export async function logout(input: { refreshToken: string }) {
  const { sessionId } = parseRefreshToken(input.refreshToken);
  await deleteSessionById(sessionId);

  logger.info({ sessionId }, "auth_logout");
}

function generateOtp(length: number) {
  // Cryptographically secure, uniform digits.
  let out = "";
  for (let i = 0; i < length; i++) out += String(randomInt(0, 10));
  return out;
}

// Same answer whether or not the email exists (no account discovery).
export async function requestPasswordReset(input: { email: string }) {
  const user = await findUserByEmailOrPhone({ email: input.email });
  if (!user?.id || !user.email) return;

  const resendCutoff = new Date(Date.now() - env.OTP_RESEND_SECONDS * 1000);
  const recent = await db
    .select()
    .from(otpRequests)
    .where(
      and(
        eq(otpRequests.userId, user.id),
        eq(otpRequests.purpose, "reset_password" as any),
      ),
    )
    .orderBy(desc(otpRequests.createdAt))
    .limit(1);
  const last = recent[0] as any;
  if (last && new Date(last.createdAt).getTime() > resendCutoff.getTime()) {
    throw new ValidationError("Please wait before requesting another code");
  }

  const code = generateOtp(env.OTP_LENGTH);
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + env.OTP_TTL_SECONDS * 1000);
  await db.insert(otpRequests).values({
    userId: user.id,
    purpose: "reset_password" as any,
    codeHash,
    expiresAt,
    attempts: "0" as any,
  });

  await sendEmail({
    to: user.email,
    subject: "Your Wymlink password reset code",
    text: `Use this code to reset your password: ${code}. It expires in ${Math.floor(
      env.OTP_TTL_SECONDS / 60,
    )} minutes.`,
    html: `<p>Use this code to reset your password:</p><h2>${code}</h2><p>This code expires in ${Math.floor(
      env.OTP_TTL_SECONDS / 60,
    )} minutes.</p>`,
  });
}

export async function resetPasswordWithOtp(input: {
  email: string;
  code: string;
  newPassword: string;
}) {
  if (input.newPassword.length < 8)
    throw new ValidationError("Password is too short");

  const user = await findUserByEmailOrPhone({ email: input.email });
  if (!user?.id || !user.email) throw new InvalidCodeError();

  const rows = await db
    .select()
    .from(otpRequests)
    .where(
      and(
        eq(otpRequests.userId, user.id),
        eq(otpRequests.purpose, "reset_password" as any),
        isNull(otpRequests.consumedAt),
        gt(otpRequests.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(otpRequests.createdAt))
    .limit(1);
  const reqRow = rows[0] as any;
  if (!reqRow) throw new InvalidCodeError();

  // Each code allows OTP_MAX_ATTEMPTS guesses, then it is burned.
  const attempts = Number(reqRow.attempts ?? 0);
  if (attempts >= env.OTP_MAX_ATTEMPTS) {
    await db.update(otpRequests).set({ consumedAt: new Date() }).where(eq(otpRequests.id, reqRow.id));
    throw new InvalidCodeError("Too many wrong codes. Request a new one.");
  }

  const ok = await bcrypt.compare(input.code, reqRow.codeHash);
  if (!ok) {
    await db
      .update(otpRequests)
      .set({ attempts: String(attempts + 1) as any })
      .where(eq(otpRequests.id, reqRow.id));
    throw new InvalidCodeError();
  }

  // Consume before changing anything so a code can't be replayed concurrently.
  const consumed = await db
    .update(otpRequests)
    .set({ consumedAt: new Date() })
    .where(and(eq(otpRequests.id, reqRow.id), isNull(otpRequests.consumedAt)))
    .returning({ id: otpRequests.id });
  if (!consumed.length) throw new InvalidCodeError();

  const passwordHash = await bcrypt.hash(input.newPassword, 12);
  await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));

  // A password reset signs out every other device.
  await revokeUserSessionsByType({ userId: user.id, sessionType: "customer" });
  await revokeUserSessionsByType({ userId: user.id, sessionType: "customer_mobile" });
  logger.info({ userId: user.id }, "auth_password_reset_sessions_revoked");
}
