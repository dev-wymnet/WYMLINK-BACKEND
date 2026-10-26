import { z } from "zod";

const isoDate = z.string().datetime({ offset: true }).or(z.string().date());

export const listPaymentsSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  customerId: z.string().uuid().optional(),
  search: z.string().min(1).max(100).optional(),
  type: z
    .enum(["deposit", "purchase", "payout", "fee", "refund", "reversal", "transfer_in", "transfer_out", "adjustment"])
    .optional(),
  direction: z.enum(["credit", "debit"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  sort: z.enum(["date", "amount"]).default("date"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export type ListPaymentsDto = z.infer<typeof listPaymentsSchema>;
