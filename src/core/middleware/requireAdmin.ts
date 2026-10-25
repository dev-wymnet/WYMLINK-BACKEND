import type { RequestHandler } from "express";

import { UnauthorizedError } from "../errors/UnauthorizedError.js";
import { ForbiddenError } from "../errors/ForbiddenError.js";
import { findUserById } from "../../modules/user/repository/user.repository.js";

const ADMIN_ROLES = new Set(["super_admin", "business_admin", "finance_admin"]);

export const requireAdmin: RequestHandler = async (req, _res, next) => {
  try {
    if (!req.user) return next(new UnauthorizedError());

    const user = await findUserById(req.user.id);
    if (!user) return next(new UnauthorizedError());

    if (user.status !== "active") return next(new ForbiddenError("Account inactive"));

    if (!ADMIN_ROLES.has(user.role)) return next(new ForbiddenError());

    (req as any).admin = { id: user.id, role: user.role, status: user.status };
    return next();
  } catch (err) {
    return next(err);
  }
};
