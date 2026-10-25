import { z } from "zod";

const isoDate = z.string().datetime({ offset: true }).or(z.string().date());

export const listBillsSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  customerId: z.string().uuid().optional(),
  search: z.string().min(1).max(100).optional(),
  country: z.string().min(2).max(3).optional(),
  currency: z.string().min(3).max(3).optional(),
  status: z.string().min(1).max(32).optional(),
  type: z.enum(["airtime", "data"]).optional(),
  provider: z.string().min(1).max(64).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  sort: z.enum(["date", "amount"]).default("date"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export type ListBillsDto = z.infer<typeof listBillsSchema>;
