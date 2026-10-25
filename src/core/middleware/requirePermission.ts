import type { RequestHandler } from "express";

import { ForbiddenError } from "../errors/ForbiddenError.js";
import { findUserById } from "../../modules/user/repository/user.repository.js";
import { getRolePermissions, Permissions, type Permission } from "../authz/permissions.js";

export function requirePermission(permission: keyof typeof Permissions | Permission): RequestHandler {
  return async (req, _res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) return next(new ForbiddenError());

      const user = await findUserById(userId);
      if (!user || user.status !== "active") return next(new ForbiddenError());

      if (user.role === "super_admin") return next();

      const rolePerms = getRolePermissions(user.role);
      if (!rolePerms.includes(permission as any)) return next(new ForbiddenError());

      return next();
    } catch (err) {
      return next(err);
    }
  };
}
