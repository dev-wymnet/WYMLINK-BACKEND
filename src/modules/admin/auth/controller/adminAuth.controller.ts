import type { RequestHandler } from "express";
import { getRolePermissions } from "../../../../core/authz/permissions.js";

import {
  adminChangePasswordSchema,
  adminLoginSchema,
  adminLogoutSchema,
  adminMfaSchema,
  adminRefreshSchema,
} from "../types/adminAuth.dto.js";
import {
  adminChangePassword,
  adminLogin,
  adminLogout,
  adminRefresh,
  adminMe,
  adminVerifyMfa,
} from "../service/adminAuth.service.js";
import { UnauthorizedError } from "../../../../core/errors/UnauthorizedError.js";

const meta = (req: Parameters<RequestHandler>[0]) => ({
  ...(req.ip ? { ip: req.ip } : {}),
  ...(req.headers["user-agent"] ? { userAgent: req.headers["user-agent"] as string } : {}),
  ...((req as any).id ? { requestId: (req as any).id } : {}),
});

export const adminMfaHandler: RequestHandler = async (req, res, next) => {
  try {
    const dto = adminMfaSchema.parse(req.body);
    res.status(200).json(await adminVerifyMfa({ mfaToken: dto.mfaToken, code: dto.code, ...meta(req) }));
  } catch (err) {
    next(err);
  }
};

export const adminChangePasswordHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const dto = adminChangePasswordSchema.parse(req.body);
    res.status(200).json(
      await adminChangePassword({
        userId: req.user.id,
        sessionId: req.user.sessionId,
        currentPassword: dto.currentPassword,
        newPassword: dto.newPassword,
        ...meta(req),
      }),
    );
  } catch (err) {
    next(err);
  }
};

export const adminLoginHandler: RequestHandler = async (req, res, next) => {
  try {
    const dto = adminLoginSchema.parse(req.body);
    const result = await adminLogin({
      password: dto.password,
      ...(dto.email ? { email: dto.email } : {}),
      ...(dto.phone ? { phone: dto.phone } : {}),
      ...(req.ip ? { ip: req.ip } : {}),
      ...(req.headers["user-agent"]
        ? { userAgent: req.headers["user-agent"] as string }
        : {}),
      ...((req as any).id ? { requestId: (req as any).id } : {}),
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const adminRefreshHandler: RequestHandler = async (req, res, next) => {
  try {
    const dto = adminRefreshSchema.parse(req.body);
    const result = await adminRefresh({
      refreshToken: dto.refreshToken,
      ...(req.ip ? { ip: req.ip } : {}),
      ...(req.headers["user-agent"]
        ? { userAgent: req.headers["user-agent"] as string }
        : {}),
      ...((req as any).id ? { requestId: (req as any).id } : {}),
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const adminLogoutHandler: RequestHandler = async (req, res, next) => {
  try {
    const dto = adminLogoutSchema.parse(req.body);
    const result = await adminLogout({
      refreshToken: dto.refreshToken,
      ...(req.ip ? { ip: req.ip } : {}),
      ...(req.headers["user-agent"]
        ? { userAgent: req.headers["user-agent"] as string }
        : {}),
      ...((req as any).id ? { requestId: (req as any).id } : {}),
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const adminMeHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user)
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Unauthorized" },
      });
    const result = await adminMe({ userId: req.user.id });
    // So the console can hide actions an admin can't perform. The backend still
    // enforces every permission per request.
    res.status(200).json({ ...result, permissions: getRolePermissions(result.admin.role) });
  } catch (err) {
    next(err);
  }
};
