import bcrypt from "bcrypt";
import { randomInt } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";

import { env } from "../../../core/config/env.js";
import { db } from "../../../core/db/client.js";
import { otpCodes } from "../../../core/db/schema.js";
import { InvalidCodeError } from "../../../core/errors/AppError.js";
import { ValidationError } from "../../../core/errors/ValidationError.js";
import { logger } from "../../../core/logger/logger.js";

export type OtpPurpose =
  | "verify_email"
  | "verify_phone"
  | "reset_password"
  | "reset_transaction_pin"
  | "reset_passcode";

function generateCode(length: number) {
  // Cryptographically secure, uniform digits.
  let out = "";
  for (let i = 0; i < length; i++) out += String(randomInt(0, 10));
  return out;
}

// Creates a code (hashed at rest) and returns the plain code for sending.
export async function issueOtp(userId: string, purpose: OtpPurpose) {
  const last = await db
    .select({ createdAt: otpCodes.createdAt })
    .from(otpCodes)
    .where(and(eq(otpCodes.userId, userId), eq(otpCodes.purpose, purpose)))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);
  if (last[0] && last[0].createdAt.getTime() > Date.now() - env.OTP_RESEND_SECONDS * 1000) {
    throw new ValidationError("Please wait a minute before requesting another code");
  }

  // A new code replaces any older unused one.
  await db
    .update(otpCodes)
    .set({ consumedAt: new Date() })
    .where(and(eq(otpCodes.userId, userId), eq(otpCodes.purpose, purpose), isNull(otpCodes.consumedAt)));

  const code = generateCode(env.OTP_LENGTH);
  await db.insert(otpCodes).values({
    userId,
    purpose,
    codeHash: await bcrypt.hash(code, 10),
    expiresAt: new Date(Date.now() + env.OTP_TTL_SECONDS * 1000),
  });
  return { code, minutes: Math.floor(env.OTP_TTL_SECONDS / 60) };
}

// Runs a "send a code" step without letting its failure reach the caller. The forgot
// password/PIN endpoints must answer identically whether or not the account exists, so
// "wait a minute before another code" and mail errors can't reveal that it does.
export async function quietly(userId: string, purpose: OtpPurpose, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    logger.warn({ userId, purpose, err: (err as Error).message }, "otp_send_suppressed");
  }
}

// Checks and burns a code. Each code allows OTP_MAX_ATTEMPTS guesses.
export async function consumeOtp(userId: string, purpose: OtpPurpose, code: string) {
  const rows = await db
    .select()
    .from(otpCodes)
    .where(
      and(
        eq(otpCodes.userId, userId),
        eq(otpCodes.purpose, purpose),
        isNull(otpCodes.consumedAt),
        gt(otpCodes.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) throw new InvalidCodeError();

  // Count the guess before comparing, atomically, so parallel guesses can't exceed the cap.
  const counted = await db
    .update(otpCodes)
    .set({ attempts: sql`${otpCodes.attempts} + 1` })
    .where(and(eq(otpCodes.id, row.id), isNull(otpCodes.consumedAt)))
    .returning({ attempts: otpCodes.attempts });
  const attempts = counted[0]?.attempts;
  if (attempts === undefined) throw new InvalidCodeError();
  if (attempts > env.OTP_MAX_ATTEMPTS) {
    await db.update(otpCodes).set({ consumedAt: new Date() }).where(eq(otpCodes.id, row.id));
    throw new InvalidCodeError("Too many wrong codes. Request a new one.");
  }

  if (!(await bcrypt.compare(code, row.codeHash))) throw new InvalidCodeError();

  // Consume before the caller changes anything so a code can't be replayed.
  const consumed = await db
    .update(otpCodes)
    .set({ consumedAt: new Date() })
    .where(and(eq(otpCodes.id, row.id), isNull(otpCodes.consumedAt)))
    .returning({ id: otpCodes.id });
  if (!consumed.length) throw new InvalidCodeError();
}
