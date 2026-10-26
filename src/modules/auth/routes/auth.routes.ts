import { Router } from "express";

import { limiter } from "../../../core/middleware/rateLimits.js";

import {
  loginHandler,
  logoutHandler,
  refreshHandler,
  signupHandler,
  forgotPasswordHandler,
  resetPasswordHandler,
} from "../controller/auth.controller.js";

export const authRoutes = Router();

const MIN = 60 * 1000;
// Password guessing: per IP and account tried.
const loginLimiter = limiter({ windowMs: 15 * MIN, max: 10, by: "ip+identity" });
const signupLimiter = limiter({ windowMs: 60 * MIN, max: 10 });
const resetLimiter = limiter({ windowMs: 15 * MIN, max: 10, by: "ip+identity" });
const refreshLimiter = limiter({ windowMs: MIN, max: 30 });

authRoutes.post("/signup", signupLimiter, signupHandler);
authRoutes.post("/login", loginLimiter, loginHandler);
authRoutes.post("/refresh", refreshLimiter, refreshHandler);
authRoutes.post("/logout", logoutHandler);
authRoutes.post("/password/forgot", resetLimiter, forgotPasswordHandler);
authRoutes.post("/password/reset", resetLimiter, resetPasswordHandler);
