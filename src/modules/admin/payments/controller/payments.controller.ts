import type { RequestHandler } from "express";

import { listPaymentsSchema } from "../types/payments.dto.js";
import { listAdminPayments, getAdminPaymentById } from "../service/payments.service.js";
import { UnauthorizedError } from "../../../../core/errors/UnauthorizedError.js";

export const listPaymentsHandler: RequestHandler = async (req, res, next) => {
  try {
    const query = listPaymentsSchema.parse(req.query);
    const result = await listAdminPayments(query);
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
};

export const getPaymentHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const id = String(req.params.id);
    const row = await getAdminPaymentById(id);
    if (!row) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Transaction not found" } });
    res.status(200).json({ success: true, ...row });
  } catch (err) {
    next(err);
  }
};
