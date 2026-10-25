export type UserRole = "customer" | "reseller" | "admin" | "support";

export type UserStatus = "active" | "disabled";

export type User = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  countryCode: string;
  currencyCode: string;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
};
