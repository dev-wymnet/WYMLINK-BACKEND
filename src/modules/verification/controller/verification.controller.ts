import type { RequestHandler } from "express";

import { UnauthorizedError } from "../../../core/errors/UnauthorizedError.js";
import { NG_BANKS } from "../../../core/data/banks.js";
import { bvnVerificationSchema, ninVerificationSchema } from "../types/verification.dto.js";
import { getMyVerificationStatus, submitBvnVerification, submitNinVerification } from "../service/verification.service.js";

export const getMyVerificationHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    res.status(200).json(await getMyVerificationStatus(req.user.id));
  } catch (err) {
    next(err);
  }
};

export const submitMyBvnVerificationHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const body = bvnVerificationSchema.parse(req.body ?? {});
    const result = await submitBvnVerification({
      userId: req.user.id,
      bvn: body.bvn,
      bankCode: body.bankCode,
      accountNumber: body.accountNumber,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const submitMyNinVerificationHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const body = ninVerificationSchema.parse(req.body ?? {});
    res.status(200).json(await submitNinVerification({ userId: req.user.id, nin: body.nin }));
  } catch (err) {
    next(err);
  }
};

export const listBanksHandler: RequestHandler = (_req, res) => {
  res.status(200).json({ banks: NG_BANKS });
};
