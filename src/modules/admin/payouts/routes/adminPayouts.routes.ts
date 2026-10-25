import { Router } from "express";

import { authGuard } from "../../../../core/middleware/authGuard.js";
import { requireAdmin } from "../../../../core/middleware/requireAdmin.js";
import { requirePermission } from "../../../../core/middleware/requirePermission.js";
import { Permissions } from "../../../../core/authz/permissions.js";
import { resendPayoutOtpHandler, validatePayoutOtpHandler } from "../controller/adminPayouts.controller.js";

export const adminPayoutRoutes = Router();

adminPayoutRoutes.post(
  "/otp/validate",
  authGuard,
  requireAdmin,
  requirePermission(Permissions.ADMIN_MANAGE_PAYOUTS),
  validatePayoutOtpHandler,
);

adminPayoutRoutes.post(
  "/otp/resend",
  authGuard,
  requireAdmin,
  requirePermission(Permissions.ADMIN_MANAGE_PAYOUTS),
  resendPayoutOtpHandler,
);
