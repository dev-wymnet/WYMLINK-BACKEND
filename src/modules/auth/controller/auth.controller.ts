import type { RequestHandler } from "express";

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
} from "../service/auth.service.js";

export const signupHandler: RequestHandler = async (req, res, next) => {
  try {
    const dto = signupSchema.parse(req.body);
    const input: {
      firstName: string;
      lastName: string;
      countryCode: string;
      email?: string;
      phone?: string;
      password: string;
    } = {
      firstName: dto.firstName,
      lastName: dto.lastName,
      countryCode: dto.countryCode,
      password: dto.password,
    };
    if (dto.email) input.email = dto.email;
    if (dto.phone) input.phone = dto.phone;

    const result = await signup(input);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

export const loginHandler: RequestHandler = async (req, res, next) => {
  try {
    const dto = loginSchema.parse(req.body);
    const input: { email?: string; phone?: string; password: string } = {
      password: dto.password,
    };
    if (dto.email) input.email = dto.email;
    if (dto.phone) input.phone = dto.phone;

    const result = await login(input);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const refreshHandler: RequestHandler = async (req, res, next) => {
  try {
    const dto = refreshSchema.parse(req.body);
    const result = await refreshAccessToken(dto);
    res.status(200).json(result);
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
    await resetPasswordWithOtp({
      email: dto.email,
      code: dto.code,
      newPassword: dto.newPassword,
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
};
