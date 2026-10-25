import { Router } from "express";

import { authGuard } from "../../../../core/middleware/authGuard.js";
import { requireAdmin } from "../../../../core/middleware/requireAdmin.js";
import { adminHomeHandler } from "../controller/dashboard.controller.js";

export const adminDashboardRoutes = Router();

adminDashboardRoutes.get("/home", authGuard, requireAdmin, adminHomeHandler);
