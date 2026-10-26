import { Router } from "express";
import { limiter } from "../../../core/middleware/rateLimits.js";
import { authGuard } from "../../../core/middleware/authGuard.js";
import {
  changeTxPinHandler,
  requestTxPinResetHandler,
  resetTxPinWithOtpHandler,
  setTxPinHandler,
  pinStatusHandler,
  changePasscodeHandler,
  setPasscodeHandler,
  verifyPasscodeHandler,
} from "../controller/pin.controller.js";

export const pinRoutes = Router();

// Brute-force protection on everything that checks or replaces a secret (per IP).
const pinLimiter = limiter({ windowMs: 15 * 60 * 1000, max: 20 });

pinRoutes.get("/status", authGuard, pinStatusHandler);

// Protected endpoints for setting and changing PIN
pinRoutes.post("/transaction/set", authGuard, setTxPinHandler);
pinRoutes.post("/transaction/change", authGuard, pinLimiter, changeTxPinHandler);
pinRoutes.post("/passcode/set", authGuard, setPasscodeHandler);
pinRoutes.post("/passcode/verify", authGuard, pinLimiter, verifyPasscodeHandler);
pinRoutes.post("/passcode/change", authGuard, pinLimiter, changePasscodeHandler);

// Public endpoints for requesting and completing OTP-based reset
pinRoutes.post("/transaction/reset/request", pinLimiter, requestTxPinResetHandler);
pinRoutes.post("/transaction/reset/confirm", pinLimiter, resetTxPinWithOtpHandler);
