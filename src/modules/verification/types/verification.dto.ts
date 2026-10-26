import { z } from "zod";

export const bvnVerificationSchema = z.object({
  bvn: z.string().regex(/^\d{11}$/, "Your BVN is 11 digits"),
  // NIBSS institution code (see GET /user/banks).
  bankCode: z.string().regex(/^\d{6}$/, "Choose your bank from the list"),
  accountNumber: z.string().regex(/^\d{10}$/, "Account numbers are 10 digits"),
  // Older clients send the account name; the check uses the profile name instead.
  name: z.string().optional(),
});

export const ninVerificationSchema = z.object({
  nin: z.string().regex(/^\d{11}$/, "Your NIN is 11 digits"),
});
