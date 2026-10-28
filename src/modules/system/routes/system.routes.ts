import { Router } from "express";

import { authGuard } from "../../../core/middleware/authGuard.js";
import { requireAdmin, requireSuperAdmin } from "../../../core/middleware/requireAdmin.js";
import {
  architectureSummaryHandler,
  debugEnvHandler,
  debugDbHandler,
  debugReadinessHandler,
  debugMonetaAccountHandler,
} from "../controller/system.controller.js";

export const systemRoutes = Router();

// Diagnostics reveal schema and provider set-up: super admins only.
systemRoutes.get("/architecture", authGuard, requireAdmin, requireSuperAdmin, architectureSummaryHandler);
systemRoutes.get("/debug/env", authGuard, requireAdmin, requireSuperAdmin, debugEnvHandler);
systemRoutes.get("/debug/db", authGuard, requireAdmin, requireSuperAdmin, debugDbHandler);
systemRoutes.get("/debug/readiness", authGuard, requireAdmin, requireSuperAdmin, debugReadinessHandler);
systemRoutes.get("/debug/moneta-account/:accountNumber", authGuard, requireAdmin, requireSuperAdmin, debugMonetaAccountHandler);
