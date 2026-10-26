import { z } from "zod";

const isoDate = z.string().datetime({ offset: true }).or(z.string().date());

export const listBillsSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  customerId: z.string().uuid().optional(),
  search: z.string().min(1).max(100).optional(),
  // Order status; "attention" = outcome never confirmed by the provider.
  status: z.enum(["pending", "processing", "success", "failed", "refunded", "unknown", "attention"]).optional(),
  type: z.enum(["airtime", "data", "cable", "electricity"]).optional(),
  provider: z.enum(["peyflex", "reloadly"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  sort: z.enum(["date", "amount"]).default("date"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export type ListBillsDto = z.infer<typeof listBillsSchema>;

export const resolveBillSchema = z.object({
  decision: z.enum(["delivered", "refund"]),
  note: z.string().trim().min(5).max(500),
});
