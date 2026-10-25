import { z } from "zod";

export const createPayoutSchema = z.object({
  amount: z.string().regex(/^\d+(?:\.\d{1,8})?$/),
  bankCode: z.string().min(2),
  accountNumber: z.string().regex(/^\d{10}$/),
  narration: z.string().min(1).max(120),
  transactionPin: z.string().regex(/^\d{4}$/),
});

export type CreatePayoutInput = z.infer<typeof createPayoutSchema>;

export const validateAccountSchema = z.object({
  bankCode: z.string().min(2),
  accountNumber: z.string().regex(/^\d{10}$/),
});

export type ValidateAccountInput = z.infer<typeof validateAccountSchema>;
