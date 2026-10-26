import type { RequestHandler } from "express";
import { z } from "zod";

import { listBillsSchema, resolveBillSchema } from "../types/bills.dto.js";
import { getAdminBillById, listAdminBills, resolveAdminBill } from "../service/bills.service.js";
import { UnauthorizedError } from "../../../../core/errors/UnauthorizedError.js";
import { NotFoundError } from "../../../../core/errors/NotFoundError.js";

export const listBillsHandler: RequestHandler = async (req, res, next) => {
  try {
    const result = await listAdminBills(listBillsSchema.parse(req.query));
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
};

export const getBillHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const row = await getAdminBillById(z.string().uuid().parse(req.params.id));
    if (!row) throw new NotFoundError("Bill not found");
    res.status(200).json({ success: true, ...row });
  } catch (err) {
    next(err);
  }
};

export const resolveBillHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const body = resolveBillSchema.parse(req.body ?? {});
    const result = await resolveAdminBill({
      id: z.string().uuid().parse(req.params.id),
      decision: body.decision,
      note: body.note,
      actorAdminId: req.user.id,
      actorRole: (req as any).admin?.role,
      ip: req.ip,
      userAgent: req.get("user-agent"),
    });
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
};
