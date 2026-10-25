import type { RequestHandler } from "express";
import { z } from "zod";

import { getAdminHomeSummary } from "../service/home.service.js";

const homeQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  to: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
});

export const adminHomeHandler: RequestHandler = async (req, res, next) => {
  try {
    const q = homeQuerySchema.parse(req.query ?? {});
    const from = q.from ? new Date(q.from) : undefined;
    const to = q.to ? new Date(q.to) : undefined;
    const result = await getAdminHomeSummary({ from, to });
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
};
