import { z } from "zod";

export const bvnVerificationSchema = z.object({
  bvn: z.string().regex(/^\d{11}$/),
  bankCode: z.string().min(1),
  accountNumber: z.string().regex(/^\d{10}$/),
  name: z.string().min(1),
});

export const ninVerificationSchema = z.object({
  nin: z.string().regex(/^\d{11}$/),
});
