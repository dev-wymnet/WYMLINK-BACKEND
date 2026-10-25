import type { RequestHandler } from "express";

import { UnauthorizedError } from "../../../core/errors/UnauthorizedError.js";
import { reconcileWalletFundingTransactions } from "../../monnify/service/monnify.reconciliation.js";
import {
  createWalletSchema,
  debitWalletSchema,
  listTransactionsSchema,
} from "../types/wallet.dto.js";
import {
  createWalletAndReservedAccount,
  debitMyWallet,
  getMyTransaction,
  getWalletDetails,
  listMyTransactions,
} from "../service/wallet.service.js";
import { verifyTransactionPin } from "../../auth/service/pin.service.js";
import z from "zod";
// import { verifyTransactionPin } from "../../auth/service/pin.service.js";

export const createWalletHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const body = createWalletSchema.parse(req.body ?? {});
    const result = await createWalletAndReservedAccount({
      userId: req.user.id,
      currencyCode: body.currencyCode,
    });
    res
      .status(201)
      .json({ wallet: result.wallet, reservedAccount: result.reserved });
  } catch (err) {
    next(err);
  }
};

export const walletReconciliationHandler: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const result = await reconcileWalletFundingTransactions(req.user.id);
    res.status(200).json({ reconciliation: result });
  } catch (err) {
    next(err);
  }
};

export const myWalletHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const { wallet, reserved } = await getWalletDetails(req.user.id);
    res.status(200).json({
      balance: wallet.availableBalance,
      accountNumber: reserved?.accountNumber ?? null,
      bankName: reserved?.bankName ?? null,
      wallet,
      reservedAccount: reserved,
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

export const myTransactionByIdHandler: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const id = z.string().uuid().parse(req.params.id);
    const row = await getMyTransaction(req.user.id, id);
    res.status(200).json({ transaction: row });
  } catch (err) {
    next(err);
  }
};

export const debitWalletHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const body = debitWalletSchema.parse(req.body);
    await verifyTransactionPin({
      userId: req.user.id,
      pin: body.transactionPin,
    });
    const result = await debitMyWallet({
      userId: req.user.id,
      amount: body.amount,
      reference: body.reference,
      description: body.description,
    });
    res.status(200).json({ result });
  } catch (err) {
    next(err);
  }
};
