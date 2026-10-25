import { z } from "zod";

export const customerIdSchema = z.object({
  customerId: z.string().uuid(),
});

export const updateCustomerStatusSchema = z.object({
  status: z.enum(["active", "disabled"]),
});

export type UpdateCustomerStatusDto = z.infer<
  typeof updateCustomerStatusSchema
>;

const isoDate = z.string().datetime({ offset: true }).or(z.string().date());

export const listCustomersSchema = z.object({
  search: z.string().min(1).max(100).optional(),
  kycStatus: z.enum(["verified", "failed", "pending", "review"]).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  country: z.string().min(2).max(3).optional(),
  currency: z.string().length(3).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  sort: z.enum(["joinedAt", "name"]).default("joinedAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export type ListCustomersDto = z.infer<typeof listCustomersSchema>;

export const listCustomerTransactionsSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  type: z.string().min(1).max(32).optional(),
  status: z.string().min(1).max(32).optional(),
  currency: z.string().length(3).optional(),
  minAmount: z
    .string()
    .regex(/^\d+(?:\.\d{1,8})?$/)
    .optional(),
  maxAmount: z
    .string()
    .regex(/^\d+(?:\.\d{1,8})?$/)
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  sort: z.enum(["date", "amount"]).default("date"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export type ListCustomerTransactionsDto = z.infer<
  typeof listCustomerTransactionsSchema
>;

// Manual KYC decision by an admin. A reason is always required: it is stored
// on the customer's verification record and in the audit log.
export const reviewKycSchema = z.object({
  type: z.enum(["bvn", "nin"]),
  decision: z.enum(["approve", "reject"]),
  reason: z.string().trim().min(5).max(500),
});

export type ReviewKycDto = z.infer<typeof reviewKycSchema>;
