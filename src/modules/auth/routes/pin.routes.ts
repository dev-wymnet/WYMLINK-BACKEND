import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authGuard } from "../../../core/middleware/authGuard.js";
import {
  changeTxPinHandler,
  requestTxPinResetHandler,
  resetTxPinWithOtpHandler,
  setTxPinHandler,
  pinStatusHandler,
  changePasscodeHandler,
} from "../controller/pin.controller.js";

export const pinRoutes = Router();

// Brute-force protection on everything that checks or replaces a secret (per IP).
const pinLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

pinRoutes.get("/status", authGuard, pinStatusHandler);

// Protected endpoints for setting and changing PIN
pinRoutes.post("/transaction/set", authGuard, setTxPinHandler);
pinRoutes.post("/transaction/change", authGuard, pinLimiter, changeTxPinHandler);
pinRoutes.post("/passcode/change", authGuard, changePasscodeHandler);

// Public endpoints for requesting and completing OTP-based reset
pinRoutes.post("/transaction/reset/request", pinLimiter, requestTxPinResetHandler);
pinRoutes.post("/transaction/reset/confirm", pinLimiter, resetTxPinWithOtpHandler);
