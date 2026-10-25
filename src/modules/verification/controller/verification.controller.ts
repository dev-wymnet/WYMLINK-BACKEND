import type { RequestHandler } from "express";

import { UnauthorizedError } from "../../../core/errors/UnauthorizedError.js";
import { bvnVerificationSchema, ninVerificationSchema } from "../types/verification.dto.js";
import { getMyVerificationStatus, submitBvnVerification, submitNinVerification } from "../service/verification.service.js";

export const getMyVerificationHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const result = await getMyVerificationStatus(req.user.id);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const submitMyBvnVerificationHandler: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const body = bvnVerificationSchema.parse(req.body ?? {});
    const result = await submitBvnVerification({
      userId: req.user.id,
      bvn: body.bvn,
      bankCode: body.bankCode,
      accountNumber: body.accountNumber,
      name: body.name,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const submitMyNinVerificationHandler: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const body = ninVerificationSchema.parse(req.body ?? {});
    const result = await submitNinVerification({ userId: req.user.id, nin: body.nin });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};
