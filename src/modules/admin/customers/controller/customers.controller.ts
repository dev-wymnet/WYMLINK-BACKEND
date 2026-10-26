import type { RequestHandler } from "express";

import { UnauthorizedError } from "../../../../core/errors/UnauthorizedError.js";
import {
  customerIdSchema,
  listCustomerTransactionsSchema,
  listCustomersSchema,
  reviewKycSchema,
  updateCustomerStatusSchema,
} from "../types/customers.dto.js";
import {
  getCustomerAdmin,
  listCustomerTransactionsAdmin,
  listCustomersAdmin,
  reviewCustomerKyc,
  updateCustomerStatus,
} from "../service/customers.service.js";

export const listCustomersHandler: RequestHandler = async (req, res, next) => {
  try {
    const q = listCustomersSchema.parse(req.query ?? {});
    const from = q.from ? new Date(q.from) : undefined;
    const to = q.to ? new Date(q.to) : undefined;

    const result = await listCustomersAdmin({
      page: q.page,
      limit: q.limit,
      search: q.search,
      kycStatus: q.kycStatus,
      status: q.status,
      country: q.country,
      currency: q.currency,
      from,
      to,
      sort: q.sort,
      order: q.order,
    });

    res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
};

export const getCustomerHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const { customerId } = customerIdSchema.parse({
      customerId: req.params.customerId,
    });
    const result = await getCustomerAdmin(customerId);
    res.status(200).json({ success: true, customer: result });
  } catch (err) {
    next(err);
  }
};

export const listCustomerTransactionsHandler: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const { customerId } = customerIdSchema.parse({
      customerId: req.params.customerId,
    });
    const q = listCustomerTransactionsSchema.parse(req.query ?? {});
    const from = q.from ? new Date(q.from) : undefined;
    const to = q.to ? new Date(q.to) : undefined;

    const result = await listCustomerTransactionsAdmin({
      customerId,
      from,
      to,
      type: q.type,
      direction: q.direction,
      minAmount: q.minAmount,
      maxAmount: q.maxAmount,
      page: q.page,
      limit: q.limit,
      sort: q.sort,
      order: q.order,
    });

    res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
};

export const updateCustomerStatusHandler: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const { customerId } = customerIdSchema.parse({
      customerId: req.params.customerId,
    });
    const dto = updateCustomerStatusSchema.parse(req.body ?? {});

    const result = await updateCustomerStatus({
      actorAdminId: req.user.id,
      actorRole: (req as any).admin?.role,
      customerId,
      status: dto.status,
      reason:
        typeof req.body?.reason === "string" ? req.body.reason : undefined,
      ip: (req.ip || undefined) as string | undefined,
      userAgent: req.headers["user-agent"] as string | undefined,
      requestId: (req as any).id as string | undefined,
    });

    res.status(200).json({ ...result, success: true });
  } catch (err) {
    next(err);
  }
};

export const reviewCustomerKycHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const { customerId } = customerIdSchema.parse({ customerId: req.params.customerId });
    const dto = reviewKycSchema.parse(req.body ?? {});

    const customer = await reviewCustomerKyc({
      actorAdminId: req.user.id,
      actorRole: (req as any).admin?.role,
      customerId,
      type: dto.type,
      decision: dto.decision,
      reason: dto.reason,
      ip: (req.ip || undefined) as string | undefined,
      userAgent: req.headers["user-agent"] as string | undefined,
      requestId: (req as any).id as string | undefined,
    });

    res.status(200).json({ success: true, customer });
  } catch (err) {
    next(err);
  }
};
