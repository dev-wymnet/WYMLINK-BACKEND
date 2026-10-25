import { Router } from "express";

import { authGuard } from "../../../core/middleware/authGuard.js";
import {
  createWalletHandler,
  debitWalletHandler,
  myTransactionByIdHandler,
  myTransactionsHandler,
  myWalletHandler,
  walletReconciliationHandler,
} from "../controller/wallet.controller.js";

export const walletRoutes = Router();

walletRoutes.post("/", authGuard, createWalletHandler);
walletRoutes.get("/me", authGuard, myWalletHandler);
walletRoutes.get("/transactions", authGuard, myTransactionsHandler);
walletRoutes.get("/transactions/:id", authGuard, myTransactionByIdHandler);
walletRoutes.get("/reconciliation", authGuard, walletReconciliationHandler);
walletRoutes.post("/debit", authGuard, debitWalletHandler);
