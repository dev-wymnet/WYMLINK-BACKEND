import { z } from "zod";

export const listTransactionsSchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
});
