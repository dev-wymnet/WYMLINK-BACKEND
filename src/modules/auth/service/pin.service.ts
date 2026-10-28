import bcrypt from "bcrypt";
import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "../../../core/db/client.js";
import { pinAttempts, users } from "../../../core/db/schema.js";
import { ValidationError } from "../../../core/errors/ValidationError.js";
import {
  InvalidCodeError,
  InvalidPasscodeError,
  InvalidTransactionPinError,
  PasscodeLockedError,
  TransactionPinAlreadySetError,
  TransactionPinLockedError,
  TransactionPinNotSetError,
} from "../../../core/errors/AppError.js";
import { env } from "../../../core/config/env.js";
import { sendEmail } from "../../../core/email/mailer.js";
import { findUserByEmailOrPhone } from "../../user/repository/user.repository.js";
import { consumeOtp, issueOtp, quietly } from "./otp.service.js";

type PinKind = "transaction_pin" | "passcode";

const PIN_RE = /^\d{4}$/;
const PASSCODE_RE = /^\d{6}$/;

const policy = (kind: PinKind) =>
  kind === "passcode"
    ? { max: env.PASSCODE_MAX_ATTEMPTS, lockSeconds: env.PASSCODE_LOCK_SECONDS }
    : { max: env.TX_PIN_MAX_ATTEMPTS, lockSeconds: env.TX_PIN_LOCK_SECONDS };

async function lockedUntil(userId: string, kind: PinKind): Promise<Date | null> {
  const rows = await db
    .select({ lockedUntil: pinAttempts.lockedUntil })
    .from(pinAttempts)
    .where(and(eq(pinAttempts.userId, userId), eq(pinAttempts.kind, kind)))
    .limit(1);
  const until = rows[0]?.lockedUntil;
  return until && until.getTime() > Date.now() ? until : null;
}

async function ensureNotLocked(userId: string, kind: PinKind) {
  const until = await lockedUntil(userId, kind);
  if (!until) return;
  if (kind === "transaction_pin") throw new TransactionPinLockedError(until);
  throw new PasscodeLockedError(until);
}

// One atomic upsert: the count can't be raced past the limit. Each lockout in a row
// doubles the next (up to 256x, about a day for the PIN; forgotten after a day without
// failures), so a 4-digit PIN can't be worked through 5 guesses every few minutes.
async function registerFailure(userId: string, kind: PinKind) {
  const { max, lockSeconds } = policy(kind);
  const next = sql`${pinAttempts.failedAttempts} + 1`;
  const streak = sql`(case when ${pinAttempts.lastFailedAt} > now() - interval '24 hours' then ${pinAttempts.lockouts} else 0 end)`;
  await db
    .insert(pinAttempts)
    .values({ userId, kind, failedAttempts: 1, lastFailedAt: new Date() })
    .onConflictDoUpdate({
      target: [pinAttempts.userId, pinAttempts.kind],
      set: {
        failedAttempts: sql`case when ${next} >= ${max} then 0 else ${next} end`,
        lockouts: sql`case when ${next} >= ${max} then ${streak} + 1 else ${streak} end`,
        lockedUntil: sql`case when ${next} >= ${max} then now() + make_interval(secs => ${lockSeconds} * power(2, least(${streak}, 8))) else ${pinAttempts.lockedUntil} end`,
        lastFailedAt: new Date(),
      },
    });
}

async function clearFailures(userId: string, kind: PinKind) {
  await db
    .update(pinAttempts)
    .set({ failedAttempts: 0, lockouts: 0, lockedUntil: null })
    .where(and(eq(pinAttempts.userId, userId), eq(pinAttempts.kind, kind)));
}

async function readHashes(userId: string) {
  const rows = await db
    .select({ pin: users.transactionPinHash, passcode: users.passcodeHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0] ?? { pin: null, passcode: null };
}

export async function getTransactionPinStatus(userId: string) {
  const [{ pin, passcode }, until] = await Promise.all([readHashes(userId), lockedUntil(userId, "transaction_pin")]);
  return {
    transactionPinSet: Boolean(pin),
    passcodeSet: Boolean(passcode),
    lockedUntil: until ? until.toISOString() : null,
  };
}

// Approves a money movement. A user without a PIN is refused (never silently
// enrolled): the app must send them through the explicit set-PIN flow.
export async function verifyTransactionPin(input: { userId: string; pin: string }) {
  if (!PIN_RE.test(input.pin)) throw new ValidationError("Invalid PIN format");
  await ensureNotLocked(input.userId, "transaction_pin");
  const { pin } = await readHashes(input.userId);
  if (!pin) throw new TransactionPinNotSetError();
  if (!(await bcrypt.compare(input.pin, pin))) {
    await registerFailure(input.userId, "transaction_pin");
    throw new InvalidTransactionPinError("Incorrect transaction PIN");
  }
  await clearFailures(input.userId, "transaction_pin");
}

// First-time PIN creation only. An existing PIN can only be replaced through
// change (current PIN) or reset (emailed code) — a stolen session alone can't.
export async function createTransactionPin(input: { userId: string; pin: string }) {
  if (!PIN_RE.test(input.pin)) throw new ValidationError("Invalid PIN format");
  const updated = await db
    .update(users)
    .set({ transactionPinHash: await bcrypt.hash(input.pin, 12) })
    .where(and(eq(users.id, input.userId), isNull(users.transactionPinHash)))
    .returning({ id: users.id });
  if (!updated.length) throw new TransactionPinAlreadySetError();
}

async function writeTransactionPin(userId: string, pin: string) {
  if (!PIN_RE.test(pin)) throw new ValidationError("Invalid PIN format");
  await db.update(users).set({ transactionPinHash: await bcrypt.hash(pin, 12) }).where(eq(users.id, userId));
}

export async function changeTransactionPin(input: { userId: string; currentPin: string; newPin: string }) {
  await verifyTransactionPin({ userId: input.userId, pin: input.currentPin });
  if (input.currentPin === input.newPin) throw new ValidationError("Your new PIN must be different from the current one");
  await writeTransactionPin(input.userId, input.newPin);
}

// Always resolves the same way whether or not the email exists, so this
// endpoint can't be used to discover which emails have Wymlink accounts.
export async function requestTransactionPinReset(input: { email: string }) {
  const user = await findUserByEmailOrPhone({ email: input.email });
  if (!user?.email) return;
  const { id, email } = user;
  await quietly(id, "reset_transaction_pin", async () => {
    const { code, minutes } = await issueOtp(id, "reset_transaction_pin");
    await sendEmail({
      to: email,
      subject: "Your Wymlink PIN reset code",
      text: `Use this code to reset your Wymlink transaction PIN: ${code}. It expires in ${minutes} minutes. If you didn't ask for this, ignore this email and your PIN stays the same.`,
      html: `<p>Use this code to reset your Wymlink transaction PIN:</p><h2 style="letter-spacing:4px">${code}</h2><p>It expires in ${minutes} minutes.</p><p>If you didn't ask for this, ignore this email — your PIN stays the same.</p>`,
    });
  });
}

export async function resetTransactionPinWithOtp(input: { email: string; code: string; newPin: string }) {
  if (!PIN_RE.test(input.newPin)) throw new ValidationError("Invalid PIN format");
  const user = await findUserByEmailOrPhone({ email: input.email });
  if (!user?.email) throw new InvalidCodeError();
  await consumeOtp(user.id, "reset_transaction_pin", input.code);
  await writeTransactionPin(user.id, input.newPin);
  await clearFailures(user.id, "transaction_pin");
}

// ---- Mobile app passcode (6 digits, unlocks the app) ----

export async function createPasscode(input: { userId: string; passcode: string }) {
  if (!PASSCODE_RE.test(input.passcode)) throw new ValidationError("Your passcode must be 6 digits");
  const updated = await db
    .update(users)
    .set({ passcodeHash: await bcrypt.hash(input.passcode, 12) })
    .where(and(eq(users.id, input.userId), isNull(users.passcodeHash)))
    .returning({ id: users.id });
  if (!updated.length) throw new ValidationError("A passcode is already set. Change it instead.");
}

export async function verifyPasscode(input: { userId: string; passcode: string }) {
  if (!PASSCODE_RE.test(input.passcode)) throw new ValidationError("Invalid passcode format");
  await ensureNotLocked(input.userId, "passcode");
  const { passcode } = await readHashes(input.userId);
  if (!passcode) throw new InvalidPasscodeError("Set up your passcode first");
  if (!(await bcrypt.compare(input.passcode, passcode))) {
    await registerFailure(input.userId, "passcode");
    throw new InvalidPasscodeError();
  }
  await clearFailures(input.userId, "passcode");
}

export async function changePasscode(input: { userId: string; currentPasscode: string; newPasscode: string }) {
  await verifyPasscode({ userId: input.userId, passcode: input.currentPasscode });
  if (!PASSCODE_RE.test(input.newPasscode)) throw new ValidationError("Your passcode must be 6 digits");
  await db.update(users).set({ passcodeHash: await bcrypt.hash(input.newPasscode, 12) }).where(eq(users.id, input.userId));
}
