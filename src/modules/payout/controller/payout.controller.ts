import type { RequestHandler } from "express";

import { UnauthorizedError } from "../../../core/errors/UnauthorizedError.js";
import {
  createPayoutSchema,
  validateAccountSchema,
} from "../types/payout.dto.js";
import { verifyTransactionPin } from "../../auth/service/pin.service.js";
import {
  createPayout,
  getPayoutById,
  getPayoutStatusByReference,
  listBanks,
  validateDestinationAccount,
} from "../service/payout.service.js";

export const createPayoutHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const body = createPayoutSchema.parse(req.body ?? {});
    await verifyTransactionPin({
      userId: req.user.id,
      pin: body.transactionPin,
    });
    const result = await createPayout({ userId: req.user.id, ...body });
    res.status(202).json({ reference: result.reference, status: "PENDING" });
  } catch (err) {
    next(err);
  }
};

export const validateAccountHandler: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const query = validateAccountSchema.parse(req.query ?? {});
    const result = await validateDestinationAccount(query);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const listBanksHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const banks = await listBanks();
    res.status(200).json({ banks });
  } catch (err) {
    next(err);
  }
};

export const getPayoutHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const id = String(req.params.id);
    const row = await getPayoutById(id);
    if (row.userId !== req.user.id)
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Payout not found" },
      });
    res.status(200).json({ payout: row });
  } catch (err) {
    next(err);
  }
};

export const getPayoutStatusHandler: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const reference = String(req.query.reference || "");
    const status = await getPayoutStatusByReference(reference);
    res.status(200).json(status);
  } catch (err) {
    next(err);
  }
};
