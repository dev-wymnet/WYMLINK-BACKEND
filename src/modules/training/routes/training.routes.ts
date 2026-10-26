import { Router } from "express";

import { authGuard } from "../../../core/middleware/authGuard.js";
import { limiter } from "../../../core/middleware/rateLimits.js";
import { requireAdmin } from "../../../core/middleware/requireAdmin.js";
import {
  listTrainingRegistrationsHandler,
  registerTrainingHandler,
} from "../controller/training.controller.js";

export const trainingRoutes = Router();

// Public, and it emails the address given: limit per contact tried and per IP so it
// can't be used to spam people from WymNet's mail server.
const registerLimiter = limiter({ windowMs: 60 * 60 * 1000, max: 3, by: "ip+identity" });
const registerIpLimiter = limiter({ windowMs: 60 * 60 * 1000, max: 30 });

trainingRoutes.post("/register", registerIpLimiter, registerLimiter, registerTrainingHandler);

// Admin-only list endpoint (available to all logged-in admin roles)
trainingRoutes.get(
  "/registrations",
  authGuard,
  requireAdmin,
  listTrainingRegistrationsHandler,
);
