import { Router } from "express";

import { authGuard } from "../../../core/middleware/authGuard.js";
import { requireAdmin } from "../../../core/middleware/requireAdmin.js";
import {
  architectureSummaryHandler,
  debugEnvHandler,
  debugDbHandler,
  debugReadinessHandler,
} from "../controller/system.controller.js";

export const systemRoutes = Router();

systemRoutes.get("/architecture", architectureSummaryHandler);

// Diagnostics reveal schema and secret fragments: signed-in admins only.
systemRoutes.get("/debug/env", authGuard, requireAdmin, debugEnvHandler);
systemRoutes.get("/debug/db", authGuard, requireAdmin, debugDbHandler);
systemRoutes.get("/debug/readiness", authGuard, requireAdmin, debugReadinessHandler);
