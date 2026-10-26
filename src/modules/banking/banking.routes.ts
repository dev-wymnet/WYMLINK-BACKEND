import { Router } from "express";

import { authGuard } from "../../core/middleware/authGuard.js";
import { requireAdmin } from "../../core/middleware/requireAdmin.js";
import { requirePermission } from "../../core/middleware/requirePermission.js";
import { limiter } from "../../core/middleware/rateLimits.js";
import { Permissions } from "../../core/authz/permissions.js";
import {
  adminReleaseDepositHandler,
  adminResolvePayoutHandler,
  adminResolveTransferHandler,
  banksHandler,
  beneficiariesHandler,
  createPayoutHandler,
  createTransferHandler,
  findRecipientHandler,
  myDepositsHandler,
  myPayoutHandler,
  myPayoutsHandler,
  myTransferHandler,
  myTransfersHandler,
  myVirtualAccountHandler,
  openVirtualAccountHandler,
  payoutStatusHandler,
  quoteHandler,
  validateAccountHandler,
} from "./banking.controller.js";

const MIN = 60 * 1000;
// Moneta calls go through a proxy with a monthly request quota: limit per user.
const openLimiter = limiter({ windowMs: 60 * MIN, max: 5, by: "user" });
const lookupLimiter = limiter({ windowMs: 5 * MIN, max: 20, by: "user" });
const payoutLimiter = limiter({ windowMs: 5 * MIN, max: 10, by: "user" });
const transferLimiter = limiter({ windowMs: 5 * MIN, max: 10, by: "user" });
const statusLimiter = limiter({ windowMs: MIN, max: 10, by: "user" });

// Mounted at /wallets (next to the wallet routes).
export const accountRoutes = Router();
accountRoutes.get("/virtual-account", authGuard, myVirtualAccountHandler);
accountRoutes.post("/virtual-account", authGuard, openLimiter, openVirtualAccountHandler);
accountRoutes.get("/deposits", authGuard, myDepositsHandler);

// Mounted at /payouts. Named routes before "/:id".
export const payoutRoutes = Router();
payoutRoutes.get("/banks", authGuard, banksHandler);
payoutRoutes.get("/validate-account", authGuard, lookupLimiter, validateAccountHandler);
payoutRoutes.get("/quote", authGuard, quoteHandler);
payoutRoutes.get("/beneficiaries", authGuard, beneficiariesHandler);
payoutRoutes.get("/status/by-reference", authGuard, statusLimiter, payoutStatusHandler);
payoutRoutes.get("/", authGuard, myPayoutsHandler);
payoutRoutes.post("/", authGuard, payoutLimiter, createPayoutHandler);
payoutRoutes.get("/:id", authGuard, myPayoutHandler);

// Mounted at /transfers.
export const transferRoutes = Router();
transferRoutes.get("/recipient", authGuard, lookupLimiter, findRecipientHandler);
transferRoutes.get("/", authGuard, myTransfersHandler);
transferRoutes.post("/", authGuard, transferLimiter, createTransferHandler);
transferRoutes.get("/:id", authGuard, myTransferHandler);

// Mounted at /admin/banking: staff settle what Moneta never confirmed.
export const adminBankingRoutes = Router();
adminBankingRoutes.post("/payouts/:id/resolve", authGuard, requireAdmin, requirePermission(Permissions.ADMIN_MANAGE_PAYOUTS), adminResolvePayoutHandler);
adminBankingRoutes.post("/transfers/:id/resolve", authGuard, requireAdmin, requirePermission(Permissions.ADMIN_MANAGE_TRANSACTIONS), adminResolveTransferHandler);
adminBankingRoutes.post("/deposits/:id/release", authGuard, requireAdmin, requirePermission(Permissions.ADMIN_MANAGE_TRANSACTIONS), adminReleaseDepositHandler);
