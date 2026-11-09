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
// Password guessing: per IP and account tried, and refused attempts per IP whatever the
// account (loose: carrier IPs are shared). Guessers on many IPs meet the per-account
// lockout in loginLock.service.
const loginLimiter = limiter({ windowMs: 15 * MIN, max: 10, by: "ip+identity" });
// Per IP, failures only. A venue Wi-Fi or carrier CGNAT shares one IP; the per-account lockout
// (loginLock) is what stops guessing one account.
const loginIpFailLimiter = limiter({ windowMs: 15 * MIN, max: 200, failuresOnly: true });
const logoutLimiter = limiter({ windowMs: MIN, max: 30 });
// Sign-up: tight per contact tried, loose per IP (many customers share a carrier IP).
const signupLimiter = limiter({ windowMs: 60 * MIN, max: 5, by: "ip+identity" });
// A conference Wi-Fi or carrier CGNAT puts many real sign-ups on one IP.
const signupIpLimiter = limiter({ windowMs: 60 * MIN, max: 600 });
const resetLimiter = limiter({ windowMs: 15 * MIN, max: 10, by: "ip+identity" });
// Per session, not per IP: a shared IP must never stop customers refreshing (they'd be signed out).
const refreshLimiter = limiter({ windowMs: MIN, max: 30, by: "session" });

authRoutes.post("/signup", signupIpLimiter, signupLimiter, signupHandler);
authRoutes.post("/login", loginIpFailLimiter, loginLimiter, loginHandler);
authRoutes.post("/refresh", refreshLimiter, refreshHandler);
authRoutes.post("/logout", logoutLimiter, logoutHandler);
authRoutes.post("/password/forgot", resetLimiter, forgotPasswordHandler);
authRoutes.post("/password/reset", resetLimiter, resetPasswordHandler);
