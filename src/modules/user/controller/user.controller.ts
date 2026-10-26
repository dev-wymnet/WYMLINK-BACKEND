import type { RequestHandler } from "express";
import { z } from "zod";

import { UnauthorizedError } from "../../../core/errors/UnauthorizedError.js";
import { getMe, updateMyProfile } from "../service/user.service.js";
import { setUserReloadlyEnabled } from "../repository/user.repository.js";
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
    res.status(200).json({ user: await getMe(req.user.id) });
  } catch (err) {
    next(err);
  }
};

export const setReloadlyEnabledHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    // Admin role and permission are enforced on the route.
    const body = z.object({ userId: z.string().uuid(), enabled: z.boolean() }).parse(req.body ?? {});
    await setUserReloadlyEnabled(body.userId, body.enabled);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
};

const profileSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().min(7).max(20).optional(),
});

export const updateProfileHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const body = profileSchema.parse(req.body ?? {});
    res.status(200).json({ user: await updateMyProfile(req.user.id, body) });
  } catch (err) {
    next(err);
  }
};

const accountUpdateSchema = z.object({
  requestedFields: profileSchema
    .extend({ reason: z.string().trim().max(500).optional() })
    .refine((v) => Boolean(v.firstName || v.lastName || v.email || v.phone), {
      message: "Tell us what you want to change",
    }),
});

export const createAccountUpdateRequestHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const body = accountUpdateSchema.parse(req.body ?? {});
    const request = await createAccountUpdateRequest({ userId: req.user.id, requestedFields: body.requestedFields });
    res.status(201).json({ request });
  } catch (err) {
    next(err);
  }
};

export const listAccountUpdateRequestsHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    res.status(200).json({ requests: await listMyAccountUpdateRequests(req.user.id) });
  } catch (err) {
    next(err);
  }
};

const ticketSchema = z.object({
  subject: z.string().trim().min(3).max(120),
  message: z.string().trim().min(1).max(5000),
});

export const createSupportTicketHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const body = ticketSchema.parse(req.body ?? {});
    const ticket = await createSupportTicket({ userId: req.user.id, ...body });
    res.status(201).json({ ticket });
  } catch (err) {
    next(err);
  }
};

export const listSupportTicketsHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    res.status(200).json({ tickets: await listMySupportTickets(req.user.id) });
  } catch (err) {
    next(err);
  }
};
