import bcrypt from "bcrypt";
import { randomInt } from "crypto";
import { db } from "../../../core/db/client.js";
import { otpRequests, pinSecurity, users } from "../../../core/db/schema.js";
import { and, desc, eq, isNull, gt } from "drizzle-orm";
import { ValidationError } from "../../../core/errors/ValidationError.js";
import { UnauthorizedError } from "../../../core/errors/UnauthorizedError.js";
import {
  InvalidCodeError,
  InvalidTransactionPinError,
  TransactionPinAlreadySetError,
  TransactionPinLockedError,
  TransactionPinNotSetError,
} from "../../../core/errors/AppError.js";
import { env } from "../../../core/config/env.js";
import { sendEmail } from "../../../core/email/mailer.js";
import { findUserByEmailOrPhone } from "../../user/repository/user.repository.js";

type PinType = "passcode" | "transaction";

async function getOrInitPinSec(userId: string, pinType: PinType) {
  const rows = await db
    .select()
    .from(pinSecurity)
    .where(eq(pinSecurity.userId, userId));
  let row = rows.find((r: any) => r.pinType === pinType) as any;
  if (!row) {
    const inserted = await db
      .insert(pinSecurity)
      .values({ userId, pinType, failedAttempts: "0" as any })
      .onConflictDoNothing()
      .returning();
    row =
      inserted[0] ??
      (await db.select().from(pinSecurity).where(and(eq(pinSecurity.userId, userId), eq(pinSecurity.pinType, pinType))).limit(1))[0];
  }
  return row as any;
}

async function registerFailure(userId: string, pinType: PinType) {
  const row = await getOrInitPinSec(userId, pinType);
  const attempts = Number(row.failedAttempts ?? 0) + 1;
  const lockSeconds = pinType === "passcode" ? env.PASSCODE_LOCK_SECONDS : env.TX_PIN_LOCK_SECONDS;
  const maxAttempts = pinType === "passcode" ? env.PASSCODE_MAX_ATTEMPTS : env.TX_PIN_MAX_ATTEMPTS;
  const update: any = {
    failedAttempts: String(attempts),
    lastFailedAt: new Date(),
  };
  if (attempts >= maxAttempts) {
    update.lockedUntil = new Date(Date.now() + lockSeconds * 1000);
    update.failedAttempts = "0";
  }
  await db.update(pinSecurity).set(update).where(eq(pinSecurity.id, row.id));
}

async function clearFailures(userId: string, pinType: PinType) {
  await db
    .update(pinSecurity)
    .set({ failedAttempts: "0" as any, lockedUntil: null })
    .where(and(eq(pinSecurity.userId, userId), eq(pinSecurity.pinType, pinType)));
}

async function ensureNotLocked(userId: string, pinType: PinType) {
  const row = await getOrInitPinSec(userId, pinType);
  if (row.lockedUntil && new Date(row.lockedUntil).getTime() > Date.now()) {
    if (pinType === "transaction") throw new TransactionPinLockedError(new Date(row.lockedUntil));
    throw new UnauthorizedError("Too many attempts. Try again later.");
  }
}

async function readPinHash(userId: string): Promise<string | null> {
  const rows = await db
    .select({ hash: users.transactionPinHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return (rows[0]?.hash as string | null | undefined) ?? null;
}

export async function getTransactionPinStatus(userId: string) {
  const [hash, sec] = await Promise.all([readPinHash(userId), getOrInitPinSec(userId, "transaction")]);
  const lockedUntil =
    sec?.lockedUntil && new Date(sec.lockedUntil).getTime() > Date.now() ? new Date(sec.lockedUntil).toISOString() : null;
  return { transactionPinSet: Boolean(hash), lockedUntil };
}

// Approves a money movement. A user without a PIN is refused (never silently
// enrolled): the app must send them through the explicit set-PIN flow.
export async function verifyTransactionPin(input: { userId: string; pin: string }) {
  if (!/^\d{4}$/.test(input.pin)) throw new ValidationError("Invalid PIN format");
  await ensureNotLocked(input.userId, "transaction");
  const hash = await readPinHash(input.userId);
  if (!hash) throw new TransactionPinNotSetError();
  const ok = await bcrypt.compare(input.pin, hash);
  if (!ok) {
    await registerFailure(input.userId, "transaction");
    throw new InvalidTransactionPinError("Incorrect transaction PIN");
  }
  await clearFailures(input.userId, "transaction");
}

export async function verifyPasscode(input: { userId: string; passcode: string }) {
  if (!/^\d{6}$/.test(input.passcode)) throw new ValidationError("Invalid passcode format");
  await ensureNotLocked(input.userId, "passcode");
  const rows = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
  const user = rows[0] as any;
  if (!user?.passcodeHash) throw new UnauthorizedError("Invalid credentials");
  const ok = await bcrypt.compare(input.passcode, user.passcodeHash);
  if (!ok) {
    await registerFailure(input.userId, "passcode");
    throw new UnauthorizedError("Invalid credentials");
  }
  await clearFailures(input.userId, "passcode");
}

// Internal: writes the hash. Callers decide whether overwriting is allowed.
async function writeTransactionPin(userId: string, pin: string) {
  if (!/^\d{4}$/.test(pin)) throw new ValidationError("Invalid PIN format");
  const hash = await bcrypt.hash(pin, 12);
  await db.update(users).set({ transactionPinHash: hash }).where(eq(users.id, userId));
}

// First-time PIN creation only. An existing PIN can only be replaced through
// change (current PIN) or reset (emailed code) — a stolen session alone can't.
export async function createTransactionPin(input: { userId: string; pin: string }) {
  if (!/^\d{4}$/.test(input.pin)) throw new ValidationError("Invalid PIN format");
  const hash = await bcrypt.hash(input.pin, 12);
  const updated = await db
    .update(users)
    .set({ transactionPinHash: hash })
    .where(and(eq(users.id, input.userId), isNull(users.transactionPinHash)))
    .returning({ id: users.id });
  if (!updated.length) throw new TransactionPinAlreadySetError();
}

/** @deprecated use createTransactionPin (first time) — kept for internal callers. */
export async function setTransactionPin(input: { userId: string; pin: string }) {
  await writeTransactionPin(input.userId, input.pin);
}

export async function changeTransactionPin(input: { userId: string; currentPin: string; newPin: string }) {
  await verifyTransactionPin({ userId: input.userId, pin: input.currentPin });
  if (input.currentPin === input.newPin) throw new ValidationError("Your new PIN must be different from the current one");
  await writeTransactionPin(input.userId, input.newPin);
}

function generateOtp(length: number) {
  // Cryptographically secure, uniform digits.
  let out = "";
  for (let i = 0; i < length; i++) out += String(randomInt(0, 10));
  return out;
}

// Always resolves the same way whether or not the email exists, so this
// endpoint can't be used to discover which emails have Wymlink accounts.
export async function requestTransactionPinReset(input: { email: string }) {
  const user = await findUserByEmailOrPhone({ email: input.email });
  if (!user?.id || !user.email) return;

  const resendCutoff = Date.now() - env.OTP_RESEND_SECONDS * 1000;
  const recent = await db
    .select()
    .from(otpRequests)
    .where(and(eq(otpRequests.userId, user.id), eq(otpRequests.purpose, "reset_transaction_pin")))
    .orderBy(desc(otpRequests.createdAt))
    .limit(1);
  const last = recent[0] as any;
  if (last && new Date(last.createdAt).getTime() > resendCutoff) {
    throw new ValidationError("Please wait a minute before requesting another code");
  }

  const code = generateOtp(env.OTP_LENGTH);
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + env.OTP_TTL_SECONDS * 1000);
  await db.insert(otpRequests).values({
    userId: user.id,
    purpose: "reset_transaction_pin",
    codeHash,
    expiresAt,
    attempts: "0" as any,
  });

  const minutes = Math.floor(env.OTP_TTL_SECONDS / 60);
  await sendEmail({
    to: user.email,
    subject: "Your Wymlink PIN reset code",
    text: `Use this code to reset your Wymlink transaction PIN: ${code}. It expires in ${minutes} minutes. If you didn't ask for this, ignore this email and your PIN stays the same.`,
    html: `<p>Use this code to reset your Wymlink transaction PIN:</p><h2 style="letter-spacing:4px">${code}</h2><p>It expires in ${minutes} minutes.</p><p>If you didn't ask for this, ignore this email — your PIN stays the same.</p>`,
  });
}

export async function resetTransactionPinWithOtp(input: { email: string; code: string; newPin: string }) {
  if (!/^\d{4}$/.test(input.newPin)) throw new ValidationError("Invalid PIN format");
  const user = await findUserByEmailOrPhone({ email: input.email });
  if (!user?.id || !user.email) throw new InvalidCodeError();

  const rows = await db
    .select()
    .from(otpRequests)
    .where(
      and(
        eq(otpRequests.userId, user.id),
        eq(otpRequests.purpose, "reset_transaction_pin"),
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

  // Consume first so the same code can't be replayed concurrently.
  const consumed = await db
    .update(otpRequests)
    .set({ consumedAt: new Date() })
    .where(and(eq(otpRequests.id, reqRow.id), isNull(otpRequests.consumedAt)))
    .returning({ id: otpRequests.id });
  if (!consumed.length) throw new InvalidCodeError();

  await writeTransactionPin(user.id, input.newPin);
  await clearFailures(user.id, "transaction");
}

export async function changePasscode(input: { userId: string; currentPasscode: string; newPasscode: string }) {
  await verifyPasscode({ userId: input.userId, passcode: input.currentPasscode });
  if (!/^\d{6}$/.test(input.newPasscode)) throw new ValidationError("Invalid passcode format");
  const hash = await bcrypt.hash(input.newPasscode, 12);
  await db.update(users).set({ passcodeHash: hash }).where(eq(users.id, input.userId));
}
