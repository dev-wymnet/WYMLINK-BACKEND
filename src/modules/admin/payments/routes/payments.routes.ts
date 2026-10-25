import { Router } from "express";

import { authGuard } from "../../../../core/middleware/authGuard.js";
import { requireAdmin } from "../../../../core/middleware/requireAdmin.js";
import { requirePermission } from "../../../../core/middleware/requirePermission.js";
import { Permissions } from "../../../../core/authz/permissions.js";
import { getPaymentHandler, listPaymentsHandler } from "../controller/payments.controller.js";

export const adminPaymentsRoutes = Router();

adminPaymentsRoutes.get(
  "/",
  authGuard,
  requireAdmin,
  requirePermission(Permissions.ADMIN_VIEW_PAYMENTS),
  listPaymentsHandler,
);

adminPaymentsRoutes.get(
  "/:id",
  authGuard,
  requireAdmin,
  requirePermission(Permissions.ADMIN_VIEW_PAYMENTS),
  getPaymentHandler,
);
