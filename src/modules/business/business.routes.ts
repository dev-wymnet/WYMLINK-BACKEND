import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";

import { UnauthorizedError } from "../../core/errors/UnauthorizedError.js";
import { authGuard } from "../../core/middleware/authGuard.js";
import { requireAdmin, requireSuperAdmin } from "../../core/middleware/requireAdmin.js";
import { limiter } from "../../core/middleware/rateLimits.js";
import { parseMoneyToCents } from "../../core/utils/money.js";
import { verifyTransactionPin } from "../auth/service/pin.service.js";
import {
  businessPayments,
  createBusiness,
  listBusinesses,
  openBusinessAccount,
  payBusiness,
  publicBusiness,
  setBusinessActive,
} from "./business.service.js";

const wrap =
  (fn: (req: Request) => Promise<unknown>, status = 200): RequestHandler =>
  async (req, res, next) => {
    try {
      res.status(status).json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

const staffOf = (req: Request) => ({
  id: (req as any).admin?.id ?? req.user!.id,
  role: (req as any).admin?.role,
  ip: req.ip,
  userAgent: req.get("user-agent"),
});

const code = z.string().trim().regex(/^[A-Za-z0-9]{6}$/, "That isn't a Wymlink business code").transform((s) => s.toUpperCase());
const money = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const s = typeof v === "number" ? v.toFixed(2) : v.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    ctx.addIssue({ code: "custom", message: "Enter a valid amount" });
    return z.NEVER;
  }
  return parseMoneyToCents(s);
});

// ---------- Customers (mounted at /businesses) ----------

export const businessRoutes = Router();
const lookupLimiter = limiter({ windowMs: 60_000, max: 300 }); // per IP: a venue shares one
const payLimiter = limiter({ windowMs: 5 * 60_000, max: 10, by: "user" });

// What a scanned QR code shows: no sign-in needed (the website's pay page shows it first).
businessRoutes.get("/:code", lookupLimiter, wrap(async (req) => ({ business: await publicBusiness(code.parse(req.params.code)) })));

// Pay a business from the customer's account: an ordinary Wymlink transfer, PIN-approved.
businessRoutes.post(
  "/:code/pay",
  authGuard,
  payLimiter,
  wrap(async (req) => {
    if (!req.user) throw new UnauthorizedError();
    const body = z
      .object({
        amount: money,
        transactionPin: z.string().regex(/^\d{4}$/),
        reference: z.string().min(8).max(64).regex(/^[A-Za-z0-9_\-]+$/, "Invalid reference"),
      })
      .parse(req.body ?? {});
    await verifyTransactionPin({ userId: req.user.id, pin: body.transactionPin });
    return payBusiness({ userId: req.user.id, code: code.parse(req.params.code), reference: body.reference, amountCents: body.amount });
  }),
);

// ---------- Staff (mounted at /admin/businesses) ----------

export const adminBusinessRoutes = Router();
const manageLimiter = limiter({ windowMs: 60_000, max: 20, by: "user" });

adminBusinessRoutes.get("/", authGuard, requireAdmin, wrap(async () => ({ businesses: await listBusinesses() })));

adminBusinessRoutes.get(
  "/:id/payments",
  authGuard,
  requireAdmin,
  wrap(async (req) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    return { payments: await businessPayments(z.string().uuid().parse(req.params.id), q.limit) };
  }),
);

adminBusinessRoutes.post(
  "/",
  authGuard,
  requireAdmin,
  requireSuperAdmin,
  manageLimiter,
  wrap(async (req) => {
    const body = z.object({ name: z.string().trim().min(2).max(80) }).parse(req.body ?? {});
    return { business: await createBusiness({ name: body.name, staff: staffOf(req) }) };
  }, 201),
);

adminBusinessRoutes.post(
  "/:id/open-account",
  authGuard,
  requireAdmin,
  requireSuperAdmin,
  manageLimiter,
  wrap(async (req) => ({ business: await openBusinessAccount(z.string().uuid().parse(req.params.id), staffOf(req)) })),
);

adminBusinessRoutes.patch(
  "/:id",
  authGuard,
  requireAdmin,
  requireSuperAdmin,
  manageLimiter,
  wrap(async (req) => {
    const body = z.object({ active: z.boolean() }).parse(req.body ?? {});
    return { business: await setBusinessActive(z.string().uuid().parse(req.params.id), body.active, staffOf(req)) };
  }),
);
