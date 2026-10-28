import type { RequestHandler } from "express";

import { UnauthorizedError } from "../errors/UnauthorizedError.js";
import { ForbiddenError } from "../errors/ForbiddenError.js";
import { PasswordChangeRequiredError } from "../errors/AppError.js";
import { findUserById } from "../../modules/user/repository/user.repository.js";

const ADMIN_ROLES = new Set(["super_admin", "business_admin", "finance_admin"]);

// An active staff account, signed in through the admin console: a customer session never
// passes, even for an account later made staff. Until a staff member replaces a password
// someone else chose, only their own account routes work.
function staffGuard(allowPendingPassword: boolean): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (!req.user) return next(new UnauthorizedError());
      if (req.user.sessionKind !== "admin") return next(new ForbiddenError());

      const user = await findUserById(req.user.id);
      if (!user) return next(new UnauthorizedError());

      if (user.status !== "active") return next(new ForbiddenError("Account inactive"));

      if (!ADMIN_ROLES.has(user.role)) return next(new ForbiddenError());

      if (user.mustChangePassword && !allowPendingPassword) return next(new PasswordChangeRequiredError());

      (req as any).admin = { id: user.id, role: user.role, status: user.status, name: `${user.firstName} ${user.lastName}`.trim() };
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

export const requireAdmin = staffGuard(false);

/** The signed-in staff member's own account routes (who am I, change password). */
export const requireAdminAccount = staffGuard(true);

/** After requireAdmin: super admins only. */
export const requireSuperAdmin: RequestHandler = (req, _res, next) =>
  (req as any).admin?.role === "super_admin" ? next() : next(new ForbiddenError());
