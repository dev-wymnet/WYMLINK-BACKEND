import { z } from "zod";

const emailSchema = z.string().email();
const phoneSchema = z.string().min(7).max(20);

export const adminLoginSchema = z
  .object({
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    password: z.string().min(1).max(72),
  })
  .refine((v) => Boolean(v.email || v.phone), {
    message: "Email or phone is required",
    path: ["email"],
  });

export type AdminLoginDto = z.infer<typeof adminLoginSchema>;

export const adminRefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export type AdminRefreshDto = z.infer<typeof adminRefreshSchema>;

export const adminLogoutSchema = z.object({
  refreshToken: z.string().min(1),
});

export type AdminLogoutDto = z.infer<typeof adminLogoutSchema>;
