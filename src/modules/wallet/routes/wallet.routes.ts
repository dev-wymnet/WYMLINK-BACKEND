import { Router } from "express";

import { authGuard } from "../../../core/middleware/authGuard.js";
import {
  myTransactionByIdHandler,
  myTransactionsHandler,
  myWalletHandler,
} from "../controller/wallet.controller.js";

export const walletRoutes = Router();

walletRoutes.get("/me", authGuard, myWalletHandler);
walletRoutes.get("/transactions", authGuard, myTransactionsHandler);
walletRoutes.get("/transactions/:id", authGuard, myTransactionByIdHandler);
