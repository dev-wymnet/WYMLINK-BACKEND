import type { RequestHandler } from "express";
import { z } from "zod";
import { UnauthorizedError } from "../../../core/errors/UnauthorizedError.js";
import { verifyTransactionPin } from "../../auth/service/pin.service.js";
import {
  listCableProviders,
  listCablePlans,
  subscribeCable,
  verifyCableIUC,
  listElectricityPlans,
  verifyElectricity,
  subscribeElectricity,
} from "../service/bills.service.js";

export const cableProvidersHandler: RequestHandler = async (
  _req,
  res,
  next,
) => {
  try {
    const result = await listCableProviders();
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const cablePlansHandler: RequestHandler = async (req, res, next) => {
  try {
    const schema = z.object({ identifier: z.string().min(1) });
    const q = schema.parse(req.query);
    const result = await listCablePlans(q.identifier);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const cableVerifyHandler: RequestHandler = async (req, res, next) => {
  try {
    const schema = z.object({
      identifier: z.string().min(1),
      iuc: z.string().min(4),
    });
    const body = schema.parse(req.body ?? {});
    const result = await verifyCableIUC(body);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const cableSubscribeHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const schema = z.object({
      internalReference: z.string().min(8).max(128),
      identifier: z.string().min(1),
      plan: z.string().min(1),
      iuc: z.string().min(4),
      phone: z.string().min(6),
      amount: z.number().positive().optional(),
      transactionPin: z.string().regex(/^\d{4}$/),
    });
    const body = schema.parse(req.body ?? {});
    await verifyTransactionPin({
      userId: req.user.id,
      pin: body.transactionPin,
    });
    const payload = {
      userId: req.user.id,
      internalReference: body.internalReference,
      identifier: body.identifier,
      plan: body.plan,
      iuc: body.iuc,
      phone: body.phone,
      ...(body.amount !== undefined && { amount: body.amount }),
    };

    const result = await subscribeCable(payload);
    res.status(200).json({ transaction: result });
  } catch (err) {
    next(err);
  }
};

export const electricityPlansHandler: RequestHandler = async (
  _req,
  res,
  next,
) => {
  try {
    const result = await listElectricityPlans();
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const electricityVerifyHandler: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    const schema = z.object({
      meter: z.string().min(6),
      plan: z.string().min(1),
      type: z.string().min(4),
    });
    const q = schema.parse(req.query);
    const result = await verifyElectricity(q);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const electricitySubscribeHandler: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const schema = z.object({
      internalReference: z.string().min(8).max(128),
      meter: z.string().min(6),
      plan: z.string().min(1),
      amount: z.number().positive(),
      type: z.string().min(4),
      phone: z.string().min(6),
      providerName: z.string().max(120).optional(),
      transactionPin: z.string().regex(/^\d{4}$/),
    });
    const body = schema.parse(req.body ?? {});
    await verifyTransactionPin({
      userId: req.user.id,
      pin: body.transactionPin,
    });
    const result = await subscribeElectricity({ userId: req.user.id, ...body });
    res.status(200).json({ transaction: result });
  } catch (err) {
    next(err);
  }
};
