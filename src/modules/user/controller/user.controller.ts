import type { RequestHandler } from "express";

import { UnauthorizedError } from "../../../core/errors/UnauthorizedError.js";
import { ValidationError } from "../../../core/errors/ValidationError.js";
import { getMe, updateMyProfile } from "../service/user.service.js";
import { setUserTelecomReloadlyEnabled } from "../repository/user.repository.js";
import {
  createAccountUpdateRequest,
  listMyAccountUpdateRequests,
} from "../repository/accountUpdate.repository.js";
import {
  createSupportTicket,
  listMySupportTickets,
} from "../repository/support.repository.js";

export const meHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const me = await getMe(req.user.id);
    res.status(200).json({ user: me });
  } catch (err) {
    next(err);
  }
};

export const setReloadlyEnabledHandler: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    // Admin role is enforced by requireAdmin on the route.
    const { userId, enabled } = req.body as {
      userId?: string;
      enabled?: boolean;
    };
    if (!userId || typeof enabled !== "boolean")
      throw new ValidationError("userId and enabled(boolean) are required");
    await setUserTelecomReloadlyEnabled(userId, enabled);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
};

export const updateProfileHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const {
      firstName,
      lastName,
      email,
      phone,
      countryCode,
      preferredCurrency,
    } = (req.body as any) ?? {};
    const user = await updateMyProfile(req.user.id, {
      firstName,
      lastName,
      email,
      phone,
      countryCode,
      preferredCurrency,
    });
    res.status(200).json({ user });
  } catch (err) {
    next(err);
  }
};

const allowedProfileFields = new Set([
  "firstName",
  "lastName",
  "email",
  "phone",
  "countryCode",
  "preferredCurrency",
]);

export const createAccountUpdateRequestHandler: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const { requestedFields } = req.body as {
      requestedFields?: Record<string, unknown>;
    };
    if (!requestedFields || typeof requestedFields !== "object") {
      throw new ValidationError("requestedFields must be an object");
    }
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(requestedFields)) {
      if (allowedProfileFields.has(key)) sanitized[key] = value;
    }
    if (Object.keys(sanitized).length === 0) {
      throw new ValidationError("No valid fields to update");
    }
    const reqRow = await createAccountUpdateRequest({
      userId: req.user.id,
      requestedFields: sanitized,
    });
    res.status(201).json({ request: reqRow });
  } catch (err) {
    next(err);
  }
};

export const listAccountUpdateRequestsHandler: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const rows = await listMyAccountUpdateRequests(req.user.id);
    res.status(200).json({ requests: rows });
  } catch (err) {
    next(err);
  }
};

export const createSupportTicketHandler: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const { subject, message } = req.body as {
      subject?: string;
      message?: string;
    };
    if (!subject || !message)
      throw new ValidationError("subject and message are required");
    const ticket = await createSupportTicket({
      userId: req.user.id,
      subject,
      message,
    });
    res.status(201).json({ ticket });
  } catch (err) {
    next(err);
  }
};

export const listSupportTicketsHandler: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const rows = await listMySupportTickets(req.user.id);
    res.status(200).json({ tickets: rows });
  } catch (err) {
    next(err);
  }
};
