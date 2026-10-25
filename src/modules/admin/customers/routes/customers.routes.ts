import { Router } from "express";

import { authGuard } from "../../../../core/middleware/authGuard.js";
import { requireAdmin } from "../../../../core/middleware/requireAdmin.js";
import { requirePermission } from "../../../../core/middleware/requirePermission.js";
import { Permissions } from "../../../../core/authz/permissions.js";
import {
  getCustomerHandler,
  listCustomerTransactionsHandler,
  listCustomersHandler,
  reviewCustomerKycHandler,
  updateCustomerStatusHandler,
} from "../controller/customers.controller.js";

export const adminCustomersRoutes = Router();

adminCustomersRoutes.get(
  "/",
  authGuard,
  requireAdmin,
  requirePermission(Permissions.ADMIN_VIEW_USERS),
  listCustomersHandler,
);

adminCustomersRoutes.get(
  "/:customerId",
  authGuard,
  requireAdmin,
  requirePermission(Permissions.ADMIN_VIEW_USERS),
  getCustomerHandler,
);

adminCustomersRoutes.get(
  "/:customerId/transactions",
  authGuard,
  requireAdmin,
  requirePermission(Permissions.ADMIN_VIEW_TRANSACTIONS),
  listCustomerTransactionsHandler,
);

adminCustomersRoutes.patch(
  "/:customerId/status",
  authGuard,
  requireAdmin,
  requirePermission(Permissions.ADMIN_MANAGE_USERS),
  updateCustomerStatusHandler,
);

// Manual KYC decisions (approve / reject a BVN or NIN check), always audited.
adminCustomersRoutes.post(
  "/:customerId/kyc/review",
  authGuard,
  requireAdmin,
  requirePermission(Permissions.ADMIN_VERIFY_ACCOUNTS),
  reviewCustomerKycHandler,
);
