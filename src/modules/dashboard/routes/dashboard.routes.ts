import { Router } from "express";

import { authGuard } from "../../../core/middleware/authGuard.js";
import { dashboardHomeHandler } from "../controller/dashboard.controller.js";

export const dashboardRoutes = Router();

dashboardRoutes.get("/home", authGuard, dashboardHomeHandler);
