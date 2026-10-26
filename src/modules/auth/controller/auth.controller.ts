import type { Request, RequestHandler } from "express";

import {
  signupSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "../types/auth.dto.js";
import {
  login,
  logout,
  refreshAccessToken,
  signup,
  requestPasswordReset,
  resetPasswordWithOtp,
  type ClientContext,
} from "../service/auth.service.js";

const clientContext = (req: Request, dto: { client?: "web" | "mobile" | undefined; deviceId?: string | undefined }): ClientContext => ({
  client: dto.client,
  deviceId: dto.deviceId ?? null,
  ip: req.ip ?? null,
  userAgent: req.get("user-agent") ?? null,
});

export const signupHandler: RequestHandler = async (req, res, next) => {
  try {
    const dto = signupSchema.parse(req.body);
    const result = await signup(
      { firstName: dto.firstName, lastName: dto.lastName, email: dto.email, phone: dto.phone, password: dto.password },
      clientContext(req, dto),
    );
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

export const loginHandler: RequestHandler = async (req, res, next) => {
  try {
    const dto = loginSchema.parse(req.body);
    const result = await login({ email: dto.email, phone: dto.phone, password: dto.password }, clientContext(req, dto));
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const refreshHandler: RequestHandler = async (req, res, next) => {
  try {
    const dto = refreshSchema.parse(req.body);
    res.status(200).json(await refreshAccessToken(dto));
  } catch (err) {
    next(err);
  }
};

export const logoutHandler: RequestHandler = async (req, res, next) => {
  try {
    const dto = logoutSchema.parse(req.body);
    await logout(dto);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

export const forgotPasswordHandler: RequestHandler = async (req, res, next) => {
  try {
    const dto = forgotPasswordSchema.parse(req.body);
    await requestPasswordReset({ email: dto.email });
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
};

export const resetPasswordHandler: RequestHandler = async (req, res, next) => {
  try {
    const dto = resetPasswordSchema.parse(req.body);
    await resetPasswordWithOtp(dto);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
};
