import type { RequestHandler } from "express";
import { z } from "zod";
import { UnauthorizedError } from "../../../core/errors/UnauthorizedError.js";
import {
  createTransactionPin,
  getTransactionPinStatus,
  changeTransactionPin,
  requestTransactionPinReset,
  resetTransactionPinWithOtp,
  changePasscode,
  createPasscode,
  verifyPasscode,
} from "../service/pin.service.js";

export const pinStatusHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    res.status(200).json(await getTransactionPinStatus(req.user.id));
  } catch (err) {
    next(err);
  }
};

export const setTxPinHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const body = z
      .object({ pin: z.string().regex(/^\d{4}$/) })
      .parse(req.body ?? {});
    await createTransactionPin({ userId: req.user.id, pin: body.pin });
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
};

export const changeTxPinHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const body = z
      .object({
        currentPin: z.string().regex(/^\d{4}$/),
        newPin: z.string().regex(/^\d{4}$/),
      })
      .parse(req.body ?? {});
    await changeTransactionPin({
      userId: req.user.id,
      currentPin: body.currentPin,
      newPin: body.newPin,
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
};

export const requestTxPinResetHandler: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    const body = z.object({ email: z.string().email() }).parse(req.body ?? {});
    await requestTransactionPinReset({ email: body.email });
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
};

export const resetTxPinWithOtpHandler: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    const body = z
      .object({
        email: z.string().email(),
        code: z.string().min(4),
        newPin: z.string().regex(/^\d{4}$/),
      })
      .parse(req.body ?? {});
    await resetTransactionPinWithOtp({
      email: body.email,
      code: body.code,
      newPin: body.newPin,
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
};

export const changePasscodeHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const body = z
      .object({
        currentPasscode: z.string().regex(/^\d{6}$/),
        newPasscode: z.string().regex(/^\d{6}$/),
      })
      .parse(req.body ?? {});
    await changePasscode({
      userId: req.user.id,
      currentPasscode: body.currentPasscode,
      newPasscode: body.newPasscode,
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
};

const passcodeBody = z.object({ passcode: z.string().regex(/^\d{6}$/) });

// Mobile app: first-time passcode (unlocks the app).
export const setPasscodeHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const body = passcodeBody.parse(req.body ?? {});
    await createPasscode({ userId: req.user.id, passcode: body.passcode });
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
};

export const verifyPasscodeHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const body = passcodeBody.parse(req.body ?? {});
    await verifyPasscode({ userId: req.user.id, passcode: body.passcode });
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
};
