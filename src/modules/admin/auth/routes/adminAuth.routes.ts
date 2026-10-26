import { Router } from "express";
import { limiter } from "../../../../core/middleware/rateLimits.js";

import { authGuard } from "../../../../core/middleware/authGuard.js";
import { requireAdmin } from "../../../../core/middleware/requireAdmin.js";
import {
  adminLoginHandler,
  adminLogoutHandler,
  adminMeHandler,
  adminRefreshHandler,
} from "../controller/adminAuth.controller.js";

export const adminAuthRoutes = Router();

const adminLoginLimiter = limiter({ windowMs: 15 * 60 * 1000, max: 5, by: "ip+identity" });

adminAuthRoutes.post("/login", adminLoginLimiter, adminLoginHandler);
adminAuthRoutes.post("/refresh", adminRefreshHandler);
adminAuthRoutes.post("/logout", adminLogoutHandler);
adminAuthRoutes.get("/me", authGuard, requireAdmin, adminMeHandler);
