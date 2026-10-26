import { Router } from "express";

import { authGuard } from "../../../core/middleware/authGuard.js";
import { ServiceUnavailableError } from "../../../core/errors/AppError.js";

// Bank payouts move to Moneta (partner virtual-account API). Until that
// integration is live every payout endpoint answers 503 with a clear message.
export const payoutRoutes = Router();

payoutRoutes.use(authGuard, (_req, _res, next) => {
  next(new ServiceUnavailableError("Bank transfers are coming soon."));
});
