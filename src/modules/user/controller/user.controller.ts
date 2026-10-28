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
  addCustomerMessage,
  addStaffMessage,
  assignTicket,
  createSupportTicket,
  getTicketForStaff,
  listMySupportTickets,
  listTicketsForStaff,
  setTicketStatus,
} from "../repository/support.repository.js";

// The signed-in staff member (set by requireAdmin).
const staffOf = (req: Parameters<RequestHandler>[0]) => {
  const a = (req as any).admin as { id: string; name: string } | undefined;
  if (!a) throw new UnauthorizedError();
  return { id: a.id, name: a.name };
};

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
  // The payment the ticket is about ("Report a problem" on a receipt).
  relatedType: z.enum(["vtu_order", "payout", "transfer", "deposit", "ledger"]).optional(),
  relatedId: z.string().uuid().optional(),
});
const messageSchema = z.object({ body: z.string().trim().min(1).max(5000) });
const ticketId = (v: unknown) => z.string().uuid().parse(v);

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

export const addSupportMessageHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const { body } = messageSchema.parse(req.body ?? {});
    await addCustomerMessage({ userId: req.user.id, ticketId: ticketId(req.params.id), body });
    res.status(201).json({ tickets: await listMySupportTickets(req.user.id) });
  } catch (err) {
    next(err);
  }
};

// ---------- Staff (admin console) ----------

export const adminListTicketsHandler: RequestHandler = async (req, res, next) => {
  try {
    const q = z
      .object({
        status: z.enum(["open", "awaiting_customer", "resolved", "closed"]).optional(),
        assigned: z.enum(["me", "unassigned"]).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query);
    res.status(200).json({ tickets: await listTicketsForStaff({ ...q, staffId: staffOf(req).id }) });
  } catch (err) {
    next(err);
  }
};

export const adminGetTicketHandler: RequestHandler = async (req, res, next) => {
  try {
    res.status(200).json({ ticket: await getTicketForStaff(ticketId(req.params.id), staffOf(req)) });
  } catch (err) {
    next(err);
  }
};

export const adminReplyTicketHandler: RequestHandler = async (req, res, next) => {
  try {
    const body = messageSchema.extend({ resolve: z.boolean().optional(), afterMessageId: z.string().uuid().optional() }).parse(req.body ?? {});
    res.status(201).json({
      ticket: await addStaffMessage({ staff: staffOf(req), ticketId: ticketId(req.params.id), body: body.body, resolve: body.resolve, afterMessageId: body.afterMessageId }),
    });
  } catch (err) {
    next(err);
  }
};

export const adminSetTicketStatusHandler: RequestHandler = async (req, res, next) => {
  try {
    const { status } = z.object({ status: z.enum(["open", "awaiting_customer", "resolved", "closed"]) }).parse(req.body ?? {});
    res.status(200).json({ ticket: await setTicketStatus(ticketId(req.params.id), status, staffOf(req)) });
  } catch (err) {
    next(err);
  }
};

// Take a ticket ("me") or let it go ("none").
export const adminAssignTicketHandler: RequestHandler = async (req, res, next) => {
  try {
    const { assignee } = z.object({ assignee: z.enum(["me", "none"]) }).parse(req.body ?? {});
    const staff = staffOf(req);
    res.status(200).json({ ticket: await assignTicket(ticketId(req.params.id), assignee === "me" ? staff.id : null, staff) });
  } catch (err) {
    next(err);
  }
};
