import { z } from "zod";

const emailSchema = z.string().email();
const phoneSchema = z.string().min(7).max(20);

// Sent by the mobile app so its sessions are tracked per device.
const clientFields = {
  client: z.enum(["web", "mobile"]).optional(),
  deviceId: z.string().min(1).max(200).optional(),
};

export const signupSchema = z
  .object({
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    // Wymlink is Nigeria-only; kept for older clients.
    countryCode: z.literal("NG").optional(),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    password: z.string().min(8).max(72),
    ...clientFields,
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
    ...clientFields,
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
