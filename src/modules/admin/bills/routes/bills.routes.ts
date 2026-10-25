import { Router } from "express";

import { authGuard } from "../../../../core/middleware/authGuard.js";
import { requireAdmin } from "../../../../core/middleware/requireAdmin.js";
import { requirePermission } from "../../../../core/middleware/requirePermission.js";
import { Permissions } from "../../../../core/authz/permissions.js";
import { getBillHandler, listBillsHandler } from "../controller/bills.controller.js";

export const adminBillsRoutes = Router();

adminBillsRoutes.get(
  "/",
  authGuard,
  requireAdmin,
  requirePermission(Permissions.ADMIN_VIEW_BILLS),
  listBillsHandler,
);

adminBillsRoutes.get(
  "/:id",
  authGuard,
  requireAdmin,
  requirePermission(Permissions.ADMIN_VIEW_BILLS),
  getBillHandler,
);
