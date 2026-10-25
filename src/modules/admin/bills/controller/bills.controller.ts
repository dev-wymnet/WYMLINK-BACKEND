import type { RequestHandler } from "express";

import { listBillsSchema } from "../types/bills.dto.js";
import { getAdminBillById, listAdminBills } from "../service/bills.service.js";
import { UnauthorizedError } from "../../../../core/errors/UnauthorizedError.js";

export const listBillsHandler: RequestHandler = async (req, res, next) => {
  try {
    const query = listBillsSchema.parse(req.query);
    const result = await listAdminBills(query);
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
};

export const getBillHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const id = String(req.params.id);
    const row = await getAdminBillById(id);
    if (!row) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Bill not found" } });
    res.status(200).json({ success: true, ...row });
  } catch (err) {
    next(err);
  }
};
