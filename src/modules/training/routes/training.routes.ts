import { Router } from "express";

import { authGuard } from "../../../core/middleware/authGuard.js";
import { requireAdmin } from "../../../core/middleware/requireAdmin.js";
import {
  listTrainingRegistrationsHandler,
  registerTrainingHandler,
} from "../controller/training.controller.js";

export const trainingRoutes = Router();

// Public registration endpoint
trainingRoutes.post("/register", registerTrainingHandler);

// Admin-only list endpoint (available to all logged-in admin roles)
trainingRoutes.get(
  "/registrations",
  authGuard,
  requireAdmin,
  listTrainingRegistrationsHandler,
);
