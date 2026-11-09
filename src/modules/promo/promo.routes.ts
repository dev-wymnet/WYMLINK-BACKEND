import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";

import { UnauthorizedError } from "../../core/errors/UnauthorizedError.js";
import { authGuard } from "../../core/middleware/authGuard.js";
import { requireAdmin, requireSuperAdmin } from "../../core/middleware/requireAdmin.js";
import { limiter } from "../../core/middleware/rateLimits.js";
import { endEvent, eventOrders, eventOverview, myPromo, startEvent, toEventDto, updateEvent } from "./promo.service.js";

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

// ---------- Customers (mounted at /promo) ----------

export const promoRoutes = Router();

// The running event and what this customer has left (event: null when none is running).
promoRoutes.get(
  "/current",
  authGuard,
  wrap(async (req) => {
    if (!req.user) throw new UnauthorizedError();
    return myPromo(req.user.id);
  }),
);

// ---------- Staff (mounted at /admin/promo) ----------

const amount = z.coerce.number().min(0).max(1_000_000);
const settings = z.object({
  title: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(1000),
  dataMax: amount,
  airtimeMax: amount,
  tvPlans: z.array(z.string().trim().min(1).max(60)).max(10),
  tvPerProvider: z.coerce.number().int().min(0).max(10),
  budget: z.coerce.number().positive().max(100_000_000).nullable(),
});

export const adminPromoRoutes = Router();
const changeLimiter = limiter({ windowMs: 60_000, max: 30, by: "user" });

// Any signed-in staff member can see the event.
adminPromoRoutes.get("/", authGuard, requireAdmin, wrap(async () => eventOverview()));

adminPromoRoutes.get(
  "/:id/orders",
  authGuard,
  requireAdmin,
  wrap(async (req) => {
    const id = z.string().uuid().parse(req.params.id);
    const q = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    return { orders: await eventOrders(id, q.limit) };
  }),
);

// Starting an event and changing its allowances: super admins only.
adminPromoRoutes.post(
  "/",
  authGuard,
  requireAdmin,
  requireSuperAdmin,
  changeLimiter,
  wrap(async (req) => ({ event: toEventDto(await startEvent(settings.parse(req.body ?? {}), staffOf(req))) }), 201),
);

adminPromoRoutes.patch(
  "/:id",
  authGuard,
  requireAdmin,
  requireSuperAdmin,
  changeLimiter,
  wrap(async (req) => {
    const id = z.string().uuid().parse(req.params.id);
    return { event: toEventDto(await updateEvent(id, settings.partial().parse(req.body ?? {}), staffOf(req))) };
  }),
);

// The kill switch: any staff member may end the event (stopping is always the safe way).
adminPromoRoutes.post(
  "/:id/end",
  authGuard,
  requireAdmin,
  changeLimiter,
  wrap(async (req) => {
    const id = z.string().uuid().parse(req.params.id);
    return { event: toEventDto(await endEvent(id, staffOf(req))) };
  }),
);
