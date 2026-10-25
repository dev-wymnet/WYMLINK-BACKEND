import { Router } from "express";

import { authGuard } from "../../../../core/middleware/authGuard.js";
import { requireAdmin } from "../../../../core/middleware/requireAdmin.js";
import { requirePermission } from "../../../../core/middleware/requirePermission.js";
import { Permissions } from "../../../../core/authz/permissions.js";
import {
  createAdminHandler,
  getAdminHandler,
  listAdminSessionsHandler,
  listAdminsHandler,
  revokeAdminSessionsHandler,
  updateAdminRoleHandler,
  updateAdminStatusHandler,
} from "../controller/admin.controller.js";

export const adminManagementRoutes = Router();

adminManagementRoutes.get(
  "/",
  authGuard,
  requireAdmin,
  requirePermission(Permissions.ADMIN_MANAGE_ADMINS),
  listAdminsHandler,
);

adminManagementRoutes.get(
  "/:id",
  authGuard,
  requireAdmin,
  requirePermission(Permissions.ADMIN_MANAGE_ADMINS),
  getAdminHandler,
);

adminManagementRoutes.post(
  "/",
  authGuard,
  requireAdmin,
  requirePermission(Permissions.ADMIN_MANAGE_ADMINS),
  createAdminHandler,
);

adminManagementRoutes.patch(
  "/:id/status",
  authGuard,
  requireAdmin,
  requirePermission(Permissions.ADMIN_MANAGE_ADMINS),
  updateAdminStatusHandler,
);

adminManagementRoutes.patch(
  "/:id/role",
  authGuard,
  requireAdmin,
  requirePermission(Permissions.ADMIN_MANAGE_ADMINS),
  updateAdminRoleHandler,
);

adminManagementRoutes.get(
  "/:id/sessions",
  authGuard,
  requireAdmin,
  requirePermission(Permissions.ADMIN_MANAGE_ADMINS),
  listAdminSessionsHandler,
);

adminManagementRoutes.post(
  "/:id/sessions/revoke",
  authGuard,
  requireAdmin,
  requirePermission(Permissions.ADMIN_MANAGE_ADMINS),
  revokeAdminSessionsHandler,
);
