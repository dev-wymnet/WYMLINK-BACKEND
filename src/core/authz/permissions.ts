export type AdminRole = "super_admin" | "business_admin" | "finance_admin";

export const Permissions = {
  ADMIN_MANAGE_ADMINS: "ADMIN_MANAGE_ADMINS",
  ADMIN_VIEW_USERS: "ADMIN_VIEW_USERS",
  ADMIN_MANAGE_USERS: "ADMIN_MANAGE_USERS",
  ADMIN_VERIFY_ACCOUNTS: "ADMIN_VERIFY_ACCOUNTS",

  ADMIN_VIEW_WALLETS: "ADMIN_VIEW_WALLETS",
  ADMIN_MANAGE_WALLETS: "ADMIN_MANAGE_WALLETS",

  ADMIN_VIEW_TRANSACTIONS: "ADMIN_VIEW_TRANSACTIONS",
  ADMIN_MANAGE_TRANSACTIONS: "ADMIN_MANAGE_TRANSACTIONS",

  ADMIN_VIEW_PAYMENTS: "ADMIN_VIEW_PAYMENTS",
  ADMIN_MANAGE_PAYMENTS: "ADMIN_MANAGE_PAYMENTS",

  ADMIN_VIEW_PAYOUTS: "ADMIN_VIEW_PAYOUTS",
  ADMIN_MANAGE_PAYOUTS: "ADMIN_MANAGE_PAYOUTS",

  ADMIN_VIEW_BILLS: "ADMIN_VIEW_BILLS",

  ADMIN_VIEW_COMPLIANCE: "ADMIN_VIEW_COMPLIANCE",
  ADMIN_MANAGE_COMPLIANCE: "ADMIN_MANAGE_COMPLIANCE",

  ADMIN_VIEW_WEBHOOKS: "ADMIN_VIEW_WEBHOOKS",
  ADMIN_MANAGE_WEBHOOKS: "ADMIN_MANAGE_WEBHOOKS",

  ADMIN_VIEW_PROVIDERS: "ADMIN_VIEW_PROVIDERS",
  ADMIN_MANAGE_PROVIDERS: "ADMIN_MANAGE_PROVIDERS",

  ADMIN_VIEW_SYSTEM: "ADMIN_VIEW_SYSTEM",
  ADMIN_VIEW_AUDIT_LOGS: "ADMIN_VIEW_AUDIT_LOGS",

  ADMIN_MANAGE_LIMITS: "ADMIN_MANAGE_LIMITS",
} as const;

export type Permission =
  | keyof typeof Permissions
  | (typeof Permissions)[keyof typeof Permissions];

const allPermissions: Permission[] = Object.values(Permissions);

export function getRolePermissions(role: string): Permission[] {
  switch (role) {
    case "super_admin":
      return allPermissions;
    case "business_admin":
      return [
        Permissions.ADMIN_VIEW_USERS,
        Permissions.ADMIN_MANAGE_USERS,
        Permissions.ADMIN_VERIFY_ACCOUNTS,
        Permissions.ADMIN_VIEW_WALLETS,
        Permissions.ADMIN_VIEW_TRANSACTIONS,
        Permissions.ADMIN_VIEW_COMPLIANCE,
        Permissions.ADMIN_VIEW_PAYMENTS,
        Permissions.ADMIN_VIEW_PAYOUTS,
        Permissions.ADMIN_VIEW_WEBHOOKS,
        Permissions.ADMIN_VIEW_SYSTEM,
        Permissions.ADMIN_VIEW_AUDIT_LOGS,
      ];
    case "finance_admin":
      return [
        Permissions.ADMIN_VIEW_WALLETS,
        Permissions.ADMIN_VIEW_TRANSACTIONS,
        Permissions.ADMIN_VIEW_PAYMENTS,
        Permissions.ADMIN_VIEW_BILLS,
        Permissions.ADMIN_VIEW_PAYOUTS,
        Permissions.ADMIN_MANAGE_PAYOUTS,
        Permissions.ADMIN_MANAGE_TRANSACTIONS,
        Permissions.ADMIN_VIEW_COMPLIANCE,
        Permissions.ADMIN_VIEW_WEBHOOKS,
        Permissions.ADMIN_VIEW_PROVIDERS,
        Permissions.ADMIN_VIEW_SYSTEM,
        Permissions.ADMIN_VIEW_AUDIT_LOGS,
      ];
    default:
      return [];
  }
}
