import { Router } from "express";
import { limiter } from "../../../../core/middleware/rateLimits.js";

import { authGuard } from "../../../../core/middleware/authGuard.js";
import { requireAdminAccount } from "../../../../core/middleware/requireAdmin.js";
import {
  adminChangePasswordHandler,
  adminLoginHandler,
  adminLogoutHandler,
  adminMeHandler,
  adminMfaHandler,
  adminRefreshHandler,
} from "../controller/adminAuth.controller.js";

export const adminAuthRoutes = Router();

const MIN = 60 * 1000;
// Password guessing: per IP and account tried, and refused attempts per IP whatever the
// account (the per-account lockout in loginLock.service catches guessers on many IPs).
const adminLoginLimiter = limiter({ windowMs: 15 * MIN, max: 5, by: "ip+identity", failuresOnly: true });
const adminLoginIpLimiter = limiter({ windowMs: 60 * MIN, max: 20, failuresOnly: true });
const adminMfaLimiter = limiter({ windowMs: 15 * MIN, max: 30 });
const adminRefreshLimiter = limiter({ windowMs: MIN, max: 30, by: "session" });
const adminLogoutLimiter = limiter({ windowMs: MIN, max: 30 });
const adminPasswordLimiter = limiter({ windowMs: 15 * MIN, max: 5, by: "user" });

adminAuthRoutes.post("/login", adminLoginIpLimiter, adminLoginLimiter, adminLoginHandler);
adminAuthRoutes.post("/mfa", adminLoginIpLimiter, adminMfaLimiter, adminMfaHandler);
adminAuthRoutes.post("/refresh", adminRefreshLimiter, adminRefreshHandler);
adminAuthRoutes.post("/logout", adminLogoutLimiter, adminLogoutHandler);
adminAuthRoutes.get("/me", authGuard, requireAdminAccount, adminMeHandler);
adminAuthRoutes.post("/password", authGuard, requireAdminAccount, adminPasswordLimiter, adminChangePasswordHandler);
