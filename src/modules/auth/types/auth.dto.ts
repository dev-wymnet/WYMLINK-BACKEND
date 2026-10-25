import { z } from "zod";

const emailSchema = z.string().email();
const phoneSchema = z.string().min(7).max(20);

export const signupSchema = z
  .object({
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    countryCode: z.string().min(2).max(3),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    password: z.string().min(8).max(72),
  })
  .refine((v) => Boolean(v.email || v.phone), {
    message: "Email or phone is required",
    path: ["email"],
  });

export type SignupDto = z.infer<typeof signupSchema>;

export const loginSchema = z
  .object({
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    password: z.string().min(1).max(72),
  })
  .refine((v) => Boolean(v.email || v.phone), {
    message: "Email or phone is required",
    path: ["email"],
  });

export type LoginDto = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export type RefreshDto = z.infer<typeof refreshSchema>;

export const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

export type LogoutDto = z.infer<typeof logoutSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  email: emailSchema,
  code: z.string().min(4).max(10),
  newPassword: z.string().min(8).max(72),
});

export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;
