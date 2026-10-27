import { randomBytes } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { Router } from "express";
import { and, eq, gt, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../core/db/client.js";
import { qrCodes, users } from "../../core/db/schema.js";
import { NotFoundError } from "../../core/errors/NotFoundError.js";
import { UnauthorizedError } from "../../core/errors/UnauthorizedError.js";
import { ValidationError } from "../../core/errors/ValidationError.js";
import { authGuard } from "../../core/middleware/authGuard.js";
import { limiter } from "../../core/middleware/rateLimits.js";
import { centsToMoneyString, parseMoneyToCents } from "../../core/utils/money.js";
import { verifyTransactionPin } from "../auth/service/pin.service.js";
import { getMyVirtualAccount } from "../banking/account.service.js";
import { createTransfer, transferDtoFor } from "../banking/transfer.service.js";

// QR payments (ported from TAPA). The payer enters their PIN and shows a one-time code;
// the receiver scans it and enters the amount; the money moves as a normal Wymlink
// transfer (same ledger entries, limits, Moneta transfer and refunds).
//
// The QR holds only "WYMLINK1:<token>". A code works for 3 minutes, can be renewed without
// the PIN for 15 minutes after it was entered, is charged at most once (claimed with one
// conditional update before money moves), and can carry a spending cap set by the payer.

export const QR_PREFIX = "WYMLINK1:";
const TTL_MS = 3 * 60_000;
const SESSION_MS = 15 * 60_000;

const newToken = () => randomBytes(24).toString("base64url");
const tokenFrom = (payload: string) => /^WYMLINK1:([A-Za-z0-9_-]{20,64})$/.exec(payload.trim())?.[1] ?? null;

const wrap =
  (fn: (req: Request) => Promise<unknown>, status = 200): RequestHandler =>
  async (req, res, next) => {
    try {
      res.status(status).json(await fn(req));
    } catch (err) {
      next(err);
    }
  };
const userOf = (req: Request) => {
  if (!req.user) throw new UnauthorizedError();
  return req.user.id;
};
const money = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const s = typeof v === "number" ? v.toFixed(2) : v.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    ctx.addIssue({ code: "custom", message: "Enter a valid amount" });
    return z.NEVER;
  }
  return parseMoneyToCents(s);
});

async function nameOf(userId: string | null) {
  if (!userId) return null;
  const [u] = await db.select({ first: users.firstName, last: users.lastName }).from(users).where(eq(users.id, userId)).limit(1);
  return u ? `${u.first} ${u.last}`.trim() : null;
}

async function issue(ownerUserId: string, sessionStartedAt: Date, maxAmount: string | null) {
  // One live code per customer: a new one cancels the old.
  await db.update(qrCodes).set({ status: "cancelled" }).where(and(eq(qrCodes.ownerUserId, ownerUserId), eq(qrCodes.status, "active")));
  const token = newToken();
  const expiresAt = new Date(Date.now() + TTL_MS);
  await db.insert(qrCodes).values({ token, ownerUserId, expiresAt, sessionStartedAt, maxAmount });
  return { token, payload: `${QR_PREFIX}${token}`, expiresAt: expiresAt.toISOString(), maxAmount };
}

export const qrRoutes = Router();
const createLimiter = limiter({ windowMs: 5 * 60_000, max: 20, by: "user" });
const chargeLimiter = limiter({ windowMs: 5 * 60_000, max: 10, by: "user" });

// New code: PIN required. Optional cap on what the receiver can charge.
qrRoutes.post(
  "/codes",
  authGuard,
  createLimiter,
  wrap(async (req) => {
    const userId = userOf(req);
    const body = z.object({ transactionPin: z.string().regex(/^\d{4}$/), maxAmount: money.optional() }).parse(req.body ?? {});
    await verifyTransactionPin({ userId, pin: body.transactionPin });
    if (!(await getMyVirtualAccount(userId))) throw new ValidationError("Get your account number first: QR payments are sent from it.");
    if (body.maxAmount !== undefined && body.maxAmount < 10_000n) throw new ValidationError("The lowest limit is ₦100");
    return issue(userId, new Date(), body.maxAmount === undefined ? null : centsToMoneyString(body.maxAmount));
  }, 201),
);

// Fresh code replacing one from the same session, without the PIN, for 15 minutes.
qrRoutes.post(
  "/codes/renew",
  authGuard,
  createLimiter,
  wrap(async (req) => {
    const userId = userOf(req);
    const { token } = z.object({ token: z.string().min(20).max(64) }).parse(req.body ?? {});
    const [old] = await db.select().from(qrCodes).where(eq(qrCodes.token, token)).limit(1);
    if (!old || old.ownerUserId !== userId || !["active", "expired", "cancelled"].includes(old.status) || Date.now() - old.sessionStartedAt.getTime() > SESSION_MS) {
      // Not a 401: the app reads 401 as "signed out".
      throw new ValidationError("Enter your PIN to show a new code");
    }
    return issue(userId, old.sessionStartedAt, old.maxAmount);
  }),
);

// Where the payer's code stands (polled by the payer's screen).
qrRoutes.get(
  "/codes/:token",
  authGuard,
  wrap(async (req) => {
    const userId = userOf(req);
    const [c] = await db.select().from(qrCodes).where(eq(qrCodes.token, String(req.params.token))).limit(1);
    if (!c || c.ownerUserId !== userId) throw new NotFoundError("Code not found");
    let status = c.status;
    if (status === "active" && c.expiresAt.getTime() < Date.now()) {
      status = "expired";
      await db.update(qrCodes).set({ status }).where(and(eq(qrCodes.id, c.id), eq(qrCodes.status, "active")));
    }
    return { status, amount: c.amount, receiverName: await nameOf(c.receiverUserId), message: c.resultMessage, paidAt: c.usedAt, transferId: c.transferId };
  }),
);

// The receiver scanned a code: charge `amount` from the payer to the receiver.
qrRoutes.post(
  "/charge",
  authGuard,
  chargeLimiter,
  wrap(async (req) => {
    const receiverId = userOf(req);
    const body = z.object({ payload: z.string().max(200), amount: money }).parse(req.body ?? {});
    const token = tokenFrom(body.payload);
    if (!token) throw new ValidationError("That isn't a Wymlink payment code.");
    if (body.amount < 10_000n) throw new ValidationError("The minimum QR payment is ₦100");

    const receiverVa = await getMyVirtualAccount(receiverId);
    if (!receiverVa) throw new ValidationError("Get your account number first: QR payments are paid into it.");

    const [c] = await db.select().from(qrCodes).where(eq(qrCodes.token, token)).limit(1);
    if (!c) throw new NotFoundError("Code not recognised. Ask them to show their code again.");
    if (c.ownerUserId === receiverId) throw new ValidationError("You can't pay yourself.");
    if (c.status === "used" || c.status === "processing") throw new ValidationError("This code has already been used.");
    if (c.status !== "active" || c.expiresAt.getTime() < Date.now()) throw new ValidationError("This code has expired. Ask them to refresh it.");
    if (c.maxAmount !== null && body.amount > parseMoneyToCents(c.maxAmount)) {
      throw new ValidationError(`This code allows up to ₦${Number(c.maxAmount).toLocaleString("en-NG", { minimumFractionDigits: 2 })}.`);
    }

    // Claim it: only one scan can move it out of "active".
    const amount = centsToMoneyString(body.amount);
    const [claimed] = await db
      .update(qrCodes)
      .set({ status: "processing", receiverUserId: receiverId, amount })
      .where(and(eq(qrCodes.id, c.id), eq(qrCodes.status, "active"), gt(qrCodes.expiresAt, new Date())))
      .returning();
    if (!claimed) throw new ValidationError("This code was just used or has expired.");

    const finish = (status: "used" | "failed", set: Partial<typeof qrCodes.$inferInsert>) =>
      db.update(qrCodes).set({ status, ...set }).where(and(eq(qrCodes.id, c.id), inArray(qrCodes.status, ["processing"])));

    let transfer;
    try {
      transfer = await createTransfer({ senderId: c.ownerUserId, reference: `qr-${c.id}`, recipient: receiverVa.accountNumber, amountCents: body.amount, narration: "QR payment" });
    } catch (err) {
      await finish("failed", { resultMessage: (err as Error).message.slice(0, 300) });
      throw err;
    }
    if (transfer.status === "reversed") {
      const message = transfer.lastError && /insufficient|balance/i.test(transfer.lastError) ? "They don't have enough in their Wymlink account." : "The payment was declined. Nothing was taken.";
      await finish("failed", { resultMessage: message, transferId: transfer.id });
      throw new ValidationError(message);
    }
    const pending = transfer.status !== "success";
    await finish("used", { usedAt: new Date(), transferId: transfer.id, resultMessage: pending ? "Confirming with the bank" : null });
    return { status: pending ? "pending" : "success", payerName: await nameOf(c.ownerUserId), transfer: await transferDtoFor(transfer, receiverId) };
  }),
);
