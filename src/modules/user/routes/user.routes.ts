import { Router } from "express";
import rateLimit from "express-rate-limit";

import { authGuard } from "../../../core/middleware/authGuard.js";
import { requireAdmin } from "../../../core/middleware/requireAdmin.js";
import { requirePermission } from "../../../core/middleware/requirePermission.js";
import { Permissions } from "../../../core/authz/permissions.js";
import {
  createAccountUpdateRequestHandler,
  createSupportTicketHandler,
  listAccountUpdateRequestsHandler,
  listSupportTicketsHandler,
  meHandler,
  updateProfileHandler,
  setReloadlyEnabledHandler,
} from "../controller/user.controller.js";
import {
  getMyVerificationHandler,
  submitMyBvnVerificationHandler,
  submitMyNinVerificationHandler,
} from "../../verification/controller/verification.controller.js";

export const userRoutes = Router();

userRoutes.get("/me", authGuard, meHandler);
userRoutes.patch("/me", authGuard, updateProfileHandler);
userRoutes.post(
  "/account-update-requests",
  authGuard,
  createAccountUpdateRequestHandler,
);
userRoutes.get(
  "/account-update-requests",
  authGuard,
  listAccountUpdateRequestsHandler,
);
userRoutes.post("/support-tickets", authGuard, createSupportTicketHandler);
userRoutes.get("/support-tickets", authGuard, listSupportTicketsHandler);
userRoutes.patch("/reloadly/enable", authGuard, requireAdmin, requirePermission(Permissions.ADMIN_MANAGE_USERS), setReloadlyEnabledHandler);

// Verification endpoints
userRoutes.get("/me/verification", authGuard, getMyVerificationHandler);

const verifyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as any).user?.id || (req as any).ip || "anon",
});
userRoutes.post(
  "/me/verification/bvn",
  authGuard,
  verifyLimiter,
  submitMyBvnVerificationHandler,
);
userRoutes.post(
  "/me/verification/nin",
  authGuard,
  verifyLimiter,
  submitMyNinVerificationHandler,
);
