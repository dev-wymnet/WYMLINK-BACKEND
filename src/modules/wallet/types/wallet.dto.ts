import { z } from "zod";

export const createWalletSchema = z.object({
  currencyCode: z.string().min(3).max(3).default("NGN"),
});

export const listTransactionsSchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
});

export const debitWalletSchema = z.object({
  amount: z.string().min(1),
  reference: z.string().min(8).max(128),
  description: z.string().min(1).max(300),
  transactionPin: z.string().regex(/^\d{4}$/),
});
