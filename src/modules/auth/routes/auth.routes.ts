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
// Sign-up: tight per contact tried, loose per IP (many customers share a carrier IP).
const signupLimiter = limiter({ windowMs: 60 * MIN, max: 5, by: "ip+identity" });
const signupIpLimiter = limiter({ windowMs: 60 * MIN, max: 100 });
const resetLimiter = limiter({ windowMs: 15 * MIN, max: 10, by: "ip+identity" });
// Per session, not per IP: a shared IP must never stop customers refreshing (they'd be signed out).
const refreshLimiter = limiter({ windowMs: MIN, max: 30, by: "session" });

authRoutes.post("/signup", signupIpLimiter, signupLimiter, signupHandler);
authRoutes.post("/login", loginLimiter, loginHandler);
authRoutes.post("/refresh", refreshLimiter, refreshHandler);
authRoutes.post("/logout", logoutHandler);
authRoutes.post("/password/forgot", resetLimiter, forgotPasswordHandler);
authRoutes.post("/password/reset", resetLimiter, resetPasswordHandler);
