import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";

import { authGuard } from "../../../core/middleware/authGuard.js";
import { requireAdmin, requireSuperAdmin } from "../../../core/middleware/requireAdmin.js";
import { requirePermission } from "../../../core/middleware/requirePermission.js";
import { limiter } from "../../../core/middleware/rateLimits.js";
import { Permissions } from "../../../core/authz/permissions.js";
import {
  collectFromAll,
  collectFromCustomer,
  getCollectionAccount,
  listCollections,
  listOwed,
  refreshCollection,
  setCollectionAccount,
} from "./collections.service.js";
import { listBanks } from "../../moneta/moneta.partner.js";

const wrap =
  (fn: (req: Request) => Promise<unknown>): RequestHandler =>
  async (req, res, next) => {
    try {
      res.status(200).json({ success: true, ...((await fn(req)) as object) });
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

const view = [authGuard, requireAdmin, requirePermission(Permissions.ADMIN_VIEW_PAYOUTS)];
const manage = [authGuard, requireAdmin, requirePermission(Permissions.ADMIN_MANAGE_PAYOUTS)];
// Every Moneta call goes through a proxy with a monthly quota.
const moneyLimiter = limiter({ windowMs: 60 * 1000, max: 20, by: "user" });

// Mounted at /admin/collections.
export const adminCollectionsRoutes = Router();

// Moneta's bank list, for choosing the collection account.
adminCollectionsRoutes.get("/banks", ...view, wrap(async () => ({ banks: await listBanks() })));

// Where collections are paid. Only a super admin can change it.
adminCollectionsRoutes.get("/account", ...view, wrap(async () => ({ account: await getCollectionAccount() })));
adminCollectionsRoutes.post(
  "/account",
  ...manage,
  requireSuperAdmin,
  moneyLimiter,
  wrap(async (req) => {
    const body = z.object({ bankCode: z.string().regex(/^\d{1,6}$/), accountNumber: z.string().regex(/^\d{10}$/, "Account numbers are 10 digits") }).parse(req.body ?? {});
    return { account: await setCollectionAccount({ ...body, staff: staffOf(req) }) };
  }),
);

// Who owes what. ?balances=true also reads each owing customer's live Moneta balance.
adminCollectionsRoutes.get(
  "/owed",
  ...view,
  wrap(async (req) => {
    const q = z.object({ balances: z.enum(["true", "false"]).default("false") }).parse(req.query);
    return listOwed({ withBalances: q.balances === "true" });
  }),
);

// Collect from one customer ({userId}) or from everyone who owes enough ({all: true}).
adminCollectionsRoutes.post(
  "/run",
  ...manage,
  moneyLimiter,
  wrap(async (req) => {
    const body = z.union([z.object({ userId: z.string().uuid() }), z.object({ all: z.literal(true) })]).parse(req.body ?? {});
    return "all" in body ? collectFromAll(staffOf(req)) : collectFromCustomer(body.userId, staffOf(req));
  }),
);

adminCollectionsRoutes.get(
  "/",
  ...view,
  wrap(async (req) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    return { collections: await listCollections(q.limit) };
  }),
);

// Re-check an unconfirmed collection against Moneta's payout history.
adminCollectionsRoutes.post("/:id/refresh", ...manage, moneyLimiter, wrap(async (req) => ({ collection: await refreshCollection(z.string().uuid().parse(req.params.id), staffOf(req)) })));
