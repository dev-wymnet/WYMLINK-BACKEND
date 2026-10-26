import { Router } from "express";

import { authGuard } from "../../../../core/middleware/authGuard.js";
import { requireAdmin } from "../../../../core/middleware/requireAdmin.js";
import { requirePermission } from "../../../../core/middleware/requirePermission.js";
import { Permissions } from "../../../../core/authz/permissions.js";
import { getBillHandler, listBillsHandler, resolveBillHandler } from "../controller/bills.controller.js";

export const adminBillsRoutes = Router();

adminBillsRoutes.get("/", authGuard, requireAdmin, requirePermission(Permissions.ADMIN_VIEW_BILLS), listBillsHandler);
adminBillsRoutes.get("/:id", authGuard, requireAdmin, requirePermission(Permissions.ADMIN_VIEW_BILLS), getBillHandler);
// Moves money (refund) or closes an order: finance and super admins only.
adminBillsRoutes.post(
  "/:id/resolve",
  authGuard,
  requireAdmin,
  requirePermission(Permissions.ADMIN_MANAGE_TRANSACTIONS),
  resolveBillHandler,
);
