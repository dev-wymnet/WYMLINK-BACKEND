import type { RequestHandler } from "express";

import { UnauthorizedError } from "../../../core/errors/UnauthorizedError.js";
import { getDashboardHome } from "../service/dashboard.service.js";

export const dashboardHomeHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const result = await getDashboardHome(req.user.id);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};
