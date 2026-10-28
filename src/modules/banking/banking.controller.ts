import type { Request, RequestHandler } from "express";
import { z } from "zod";

import { UnauthorizedError } from "../../core/errors/UnauthorizedError.js";
import { parseMoneyToCents } from "../../core/utils/money.js";
import { insertAuditLog } from "../audit/repository/audit.repository.js";
import { verifyTransactionPin } from "../auth/service/pin.service.js";
import {
  accountSetupState,
  getMyVirtualAccount,
  checkForDeposits,
  listMyDeposits,
  openVirtualAccount,
  releaseHeldDeposit,
  toDepositDto,
  toVirtualAccountDto,
} from "./account.service.js";
import {
  banks,
  createPayout,
  getMyPayout,
  getMyPayoutByReference,
  listMyBeneficiaries,
  listMyPayouts,
  quote,
  resolvePayout,
  toPayoutDto,
  validateAccount,
} from "./payout.service.js";
import { createTransfer, findRecipient, getMyTransfer, listMyTransfers, resolveTransfer, transferDtoFor } from "./transfer.service.js";

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

const pin = z.string().regex(/^\d{4}$/);
const reference = z.string().min(8).max(128).regex(/^[A-Za-z0-9_\-:.]+$/, "Invalid reference");
// Naira with at most 2 decimals, as a string or number.
const amount = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const s = typeof v === "number" ? v.toFixed(2) : v.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    ctx.addIssue({ code: "custom", message: "Enter a valid amount" });
    return z.NEVER;
  }
  return parseMoneyToCents(s);
});
const limitQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

// ---------- Account number & deposits ----------

export const myVirtualAccountHandler = wrap(async (req) => {
  const userId = userOf(req);
  const va = await getMyVirtualAccount(userId);
  return { account: va ? toVirtualAccountDto(va) : null, setup: va ? null : await accountSetupState(userId) };
});

export const openVirtualAccountHandler = wrap(async (req) => {
  const userId = userOf(req);
  // NIN: Moneta's docs say 10 digits, real NINs are 11; both are accepted.
  const body = z.object({ bvn: z.string().regex(/^\d{11}$/, "Your BVN is 11 digits"), nin: z.string().regex(/^\d{10,11}$/, "Enter your NIN") }).parse(req.body ?? {});
  const va = await openVirtualAccount({ userId, bvn: body.bvn, nin: body.nin });
  return { account: toVirtualAccountDto(va) };
}, 201);

export const myDepositsHandler = wrap(async (req) => {
  const q = limitQuery.parse(req.query);
  await checkForDeposits(userOf(req));
  return { deposits: await listMyDeposits(userOf(req), q.limit) };
});

// ---------- Bank payouts ----------

export const banksHandler = wrap(async (req) => {
  userOf(req);
  return { banks: await banks() };
});

export const validateAccountHandler = wrap(async (req) => {
  userOf(req);
  const q = z.object({ bankCode: z.string().regex(/^\d{1,6}$/), accountNumber: z.string().regex(/^\d{10}$/, "Account numbers are 10 digits") }).parse(req.query);
  return validateAccount(q.bankCode, q.accountNumber);
});

export const quoteHandler = wrap(async (req) => {
  userOf(req);
  const q = z.object({ amount }).parse(req.query);
  return quote(q.amount);
});

export const createPayoutHandler = wrap(async (req) => {
  const userId = userOf(req);
  const body = z
    .object({
      reference: reference.optional(),
      amount,
      bankCode: z.string().regex(/^\d{1,6}$/),
      accountNumber: z.string().regex(/^\d{10}$/),
      narration: z.string().trim().max(100).default("Wymlink transfer"),
      transactionPin: pin,
    })
    .parse(req.body ?? {});
  await verifyTransactionPin({ userId, pin: body.transactionPin });
  const p = await createPayout({
    userId,
    // Older clients send no reference: one is generated (no replay protection for them).
    reference: body.reference ?? `web-${userId.slice(0, 8)}-${Date.now()}`,
    amountCents: body.amount,
    bankCode: body.bankCode,
    accountNumber: body.accountNumber,
    narration: body.narration || "Wymlink transfer",
  });
  return toPayoutDto(p);
});

export const payoutStatusHandler = wrap(async (req) => {
  const q = z.object({ reference: z.string().min(1).max(128) }).parse(req.query);
  return toPayoutDto(await getMyPayoutByReference(userOf(req), q.reference));
});

export const myPayoutsHandler = wrap(async (req) => {
  const q = limitQuery.parse(req.query);
  return { payouts: (await listMyPayouts(userOf(req), q.limit)).map(toPayoutDto) };
});

export const myPayoutHandler = wrap(async (req) => toPayoutDto(await getMyPayout(userOf(req), z.string().uuid().parse(req.params.id))));

export const beneficiariesHandler = wrap(async (req) => {
  const rows = await listMyBeneficiaries(userOf(req));
  return { beneficiaries: rows.map((b) => ({ id: b.id, bankCode: b.bankCode, bankName: b.bankName, accountNumber: b.accountNumber, accountName: b.accountName, lastUsedAt: b.lastUsedAt })) };
});

// ---------- Wymlink → Wymlink ----------

export const findRecipientHandler = wrap(async (req) => {
  const userId = userOf(req);
  const q = z.object({ query: z.string().trim().min(5).max(120) }).parse(req.query);
  const r = await findRecipient(q.query, userId);
  return { name: r.name, accountNumber: r.accountNumber };
});

export const createTransferHandler = wrap(async (req) => {
  const userId = userOf(req);
  const body = z
    .object({ reference, recipient: z.string().trim().min(5).max(120), amount, narration: z.string().trim().max(100).optional(), transactionPin: pin })
    .parse(req.body ?? {});
  await verifyTransactionPin({ userId, pin: body.transactionPin });
  const t = await createTransfer({ senderId: userId, reference: body.reference, recipient: body.recipient, amountCents: body.amount, narration: body.narration });
  return { transfer: await transferDtoFor(t, userId) };
});

export const myTransfersHandler = wrap(async (req) => {
  const q = limitQuery.parse(req.query);
  return { transfers: await listMyTransfers(userOf(req), q.limit) };
});

export const myTransferHandler = wrap(async (req) => ({ transfer: await getMyTransfer(userOf(req), z.string().uuid().parse(req.params.id)) }));

// ---------- Staff settlement ----------

const audit = (req: Request, action: string, targetType: string, targetId: string, reason: string) =>
  insertAuditLog({
    actorUserId: req.user!.id,
    actorRole: (req as any).admin?.role ?? null,
    action,
    targetType,
    targetId,
    success: true,
    reason,
    ip: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  });

const note = z.string().trim().min(5).max(500);

export const adminResolvePayoutHandler = wrap(async (req) => {
  userOf(req);
  const id = z.string().uuid().parse(req.params.id);
  const body = z.object({ decision: z.enum(["success", "reverse"]), note }).parse(req.body ?? {});
  const p = await resolvePayout({ payoutId: id, decision: body.decision, note: body.note });
  await audit(req, body.decision === "success" ? "PAYOUT_MARKED_SUCCESS" : "PAYOUT_REVERSED", "payout", id, body.note);
  return { success: true, payout: toPayoutDto(p) };
});

export const adminResolveTransferHandler = wrap(async (req) => {
  userOf(req);
  const id = z.string().uuid().parse(req.params.id);
  const body = z.object({ decision: z.enum(["success", "reverse"]), note }).parse(req.body ?? {});
  const t = await resolveTransfer({ transferId: id, decision: body.decision });
  await audit(req, body.decision === "success" ? "TRANSFER_MARKED_SUCCESS" : "TRANSFER_REVERSED", "transfer", id, body.note);
  return { success: true, status: t.status };
});

export const adminReleaseDepositHandler = wrap(async (req) => {
  userOf(req);
  const id = z.string().uuid().parse(req.params.id);
  const body = z.object({ note }).parse(req.body ?? {});
  const d = await releaseHeldDeposit(id);
  await audit(req, "DEPOSIT_RELEASED", "deposit", id, body.note);
  return { success: true, deposit: toDepositDto(d) };
});
