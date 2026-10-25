import { Router } from "express";
import rateLimit from "express-rate-limit";

import { authGuard } from "../../../core/middleware/authGuard.js";
import {
  createPayoutHandler,
  getPayoutHandler,
  getPayoutStatusHandler,
  listBanksHandler,
  validateAccountHandler,
} from "../controller/payout.controller.js";

export const payoutRoutes = Router();

const payoutLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as any).user?.id || (req as any).ip || "anon",
});

payoutRoutes.post("/", authGuard, payoutLimiter, createPayoutHandler);

const validateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as any).user?.id || (req as any).ip || "anon",
});

// Named routes must be registered before "/:id" so they are not shadowed
payoutRoutes.get("/banks", authGuard, listBanksHandler);

payoutRoutes.get(
  "/validate-account",
  authGuard,
  validateLimiter,
  validateAccountHandler,
);

payoutRoutes.get("/status/by-reference", authGuard, getPayoutStatusHandler);

payoutRoutes.get("/:id", authGuard, getPayoutHandler);
