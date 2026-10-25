import { Router } from "express";
import rateLimit from "express-rate-limit";

import { authGuard } from "../../../../core/middleware/authGuard.js";
import { requireAdmin } from "../../../../core/middleware/requireAdmin.js";
import {
  adminLoginHandler,
  adminLogoutHandler,
  adminMeHandler,
  adminRefreshHandler,
} from "../controller/adminAuth.controller.js";

export const adminAuthRoutes = Router();

const adminLoginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    `${(req as any).ip}:${req.body?.email || req.body?.phone || ""}`,
});

adminAuthRoutes.post("/login", adminLoginLimiter, adminLoginHandler);
adminAuthRoutes.post("/refresh", adminRefreshHandler);
adminAuthRoutes.post("/logout", adminLogoutHandler);
adminAuthRoutes.get("/me", authGuard, requireAdmin, adminMeHandler);
