import { z } from "zod";

export const createAdminSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email(),
  phone: z.string().min(7).max(20).optional(),
  countryCode: z.string().min(2).max(3),
  role: z.enum(["business_admin", "finance_admin", "super_admin"]),
  temporaryPassword: z.string().min(8).max(72),
});

export type CreateAdminDto = z.infer<typeof createAdminSchema>;

export const updateAdminStatusSchema = z.object({
  status: z.enum(["active", "disabled"]),
});
export type UpdateAdminStatusDto = z.infer<typeof updateAdminStatusSchema>;

export const updateAdminRoleSchema = z.object({
  role: z.enum(["business_admin", "finance_admin", "super_admin"]),
});
export type UpdateAdminRoleDto = z.infer<typeof updateAdminRoleSchema>;
