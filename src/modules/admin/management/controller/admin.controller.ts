import type { RequestHandler } from "express";

import { requirePermission } from "../../../../core/middleware/requirePermission.js";
import { Permissions } from "../../../../core/authz/permissions.js";
import {
  createAdminSchema,
  updateAdminRoleSchema,
  updateAdminStatusSchema,
} from "../types/admin.dto.js";
import {
  createAdmin,
  getAdmin,
  listAdminSessions,
  listAdmins,
  resetAdminMfa,
  revokeAdminSessions,
  updateAdminRole,
  updateAdminStatus,
} from "../service/admin.service.js";
import { UnauthorizedError } from "../../../../core/errors/UnauthorizedError.js";

export const listAdminsHandler: RequestHandler = async (req, res, next) => {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);
    const search =
      typeof req.query.search === "string" ? req.query.search : undefined;
    const result = await listAdmins({
      page,
      limit,
      ...(search ? { search } : {}),
    });
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
};

export const getAdminHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const id = String(req.params.id);
    const row = await getAdmin(id);
    if (!row)
      return res
        .status(404)
        .json({
          success: false,
          error: { code: "NOT_FOUND", message: "Admin not found" },
        });
    res.status(200).json({ success: true, admin: row });
  } catch (err) {
    next(err);
  }
};

export const createAdminHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const dto = createAdminSchema.parse(req.body ?? {});
    const result = await createAdmin({
      actorAdminId: req.user.id,
      actorRole: (req as any).admin?.role ?? "",
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      role: dto.role,
      temporaryPassword: dto.temporaryPassword,
      ...(dto.phone ? { phone: dto.phone } : {}),
      ...(req.ip ? { ip: req.ip } : {}),
      ...(typeof req.headers["user-agent"] === "string"
        ? { userAgent: req.headers["user-agent"] }
        : {}),
      ...((req as any).id ? { requestId: (req as any).id } : {}),
    });
    res.status(201).json({ success: true, id: result.id });
  } catch (err) {
    next(err);
  }
};

export const updateAdminStatusHandler: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const id = String(req.params.id);
    const dto = updateAdminStatusSchema.parse(req.body ?? {});
    const result = await updateAdminStatus({
      actorAdminId: req.user.id,
      actorRole: (req as any).admin?.role ?? "",
      targetAdminId: id,
      status: dto.status,
      ...(req.ip ? { ip: req.ip } : {}),
      ...(typeof req.headers["user-agent"] === "string"
        ? { userAgent: req.headers["user-agent"] }
        : {}),
      ...((req as any).id ? { requestId: (req as any).id } : {}),
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const updateAdminRoleHandler: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const id = String(req.params.id);
    const dto = updateAdminRoleSchema.parse(req.body ?? {});
    const result = await updateAdminRole({
      actorAdminId: req.user.id,
      actorRole: (req as any).admin?.role ?? "",
      targetAdminId: id,
      role: dto.role,
      ...(req.ip ? { ip: req.ip } : {}),
      ...(typeof req.headers["user-agent"] === "string"
        ? { userAgent: req.headers["user-agent"] }
        : {}),
      ...((req as any).id ? { requestId: (req as any).id } : {}),
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const listAdminSessionsHandler: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const id = String(req.params.id);
    const rows = await listAdminSessions(id);
    res.status(200).json({ success: true, sessions: rows });
  } catch (err) {
    next(err);
  }
};

export const revokeAdminSessionsHandler: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const id = String(req.params.id);
    const result = await revokeAdminSessions({
      actorAdminId: req.user.id,
      actorRole: (req as any).admin?.role ?? "",
      targetAdminId: id,
      ...(req.ip ? { ip: req.ip } : {}),
      ...(typeof req.headers["user-agent"] === "string"
        ? { userAgent: req.headers["user-agent"] }
        : {}),
      ...((req as any).id ? { requestId: (req as any).id } : {}),
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const resetAdminMfaHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const result = await resetAdminMfa({
      actorAdminId: req.user.id,
      actorRole: (req as any).admin?.role ?? "",
      targetAdminId: String(req.params.id),
      ...(req.ip ? { ip: req.ip } : {}),
      ...(typeof req.headers["user-agent"] === "string" ? { userAgent: req.headers["user-agent"] } : {}),
      ...((req as any).id ? { requestId: (req as any).id } : {}),
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};
