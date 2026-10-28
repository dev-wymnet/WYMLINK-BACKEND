import type { RequestHandler } from "express";
import z from "zod";

import { UnauthorizedError } from "../../../core/errors/UnauthorizedError.js";
import { listTransactionsSchema } from "../types/wallet.dto.js";
import {
  getMyTransaction,
  getWalletDetails,
  listMyTransactions,
} from "../service/wallet.service.js";
import { checkForDeposits } from "../../banking/account.service.js";

export const myWalletHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    await checkForDeposits(req.user.id);
    const { wallet, virtualAccount: va } = await getWalletDetails(req.user.id);
    res.status(200).json({
      balance: wallet.availableBalance,
      currency: wallet.currencyCode,
      status: wallet.status,
      accountNumber: va?.accountNumber ?? null,
      bankName: va?.bankName ?? null,
      reservedAccount: va ? { accountName: va.accountName, accountNumber: va.accountNumber, bankName: va.bankName } : null,
    });
  } catch (err) {
    next(err);
  }
};

export const myTransactionsHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const q = listTransactionsSchema.parse(req.query);
    const rows = await listMyTransactions(req.user.id, q.limit);
    res.status(200).json({ transactions: rows });
  } catch (err) {
    next(err);
  }
};

export const myTransactionByIdHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const id = z.string().uuid().parse(req.params.id);
    const row = await getMyTransaction(req.user.id, id);
    res.status(200).json({ transaction: row });
  } catch (err) {
    next(err);
  }
};
