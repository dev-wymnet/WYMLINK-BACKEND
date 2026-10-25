import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  numeric,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const countries = pgTable(
  "countries",
  {
    code: text("code").primaryKey(),
    name: text("name").notNull(),
    currencyCode: text("currency_code").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    enabledIdx: index("countries_enabled_idx").on(t.enabled),
  }),
);

// Tracks per-user PIN/passcode attempt counters and lockouts
export const pinSecurity = pgTable(
  "pin_security",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pinType: text("pin_type").notNull(), // "passcode" | "transaction"
    failedAttempts: numeric("failed_attempts", { precision: 10, scale: 0 })
      .notNull()
      .default("0"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastFailedAt: timestamp("last_failed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userTypeUnique: uniqueIndex("pin_security_user_type_unique").on(
      t.userId,
      t.pinType,
    ),
    userIdIdx: index("pin_security_user_id_idx").on(t.userId),
  }),
);

// Email OTP requests for password/passcode/transaction pin resets
export const otpRequests = pgTable(
  "otp_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(), // reset_password | reset_passcode | reset_transaction_pin
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    attempts: numeric("attempts", { precision: 10, scale: 0 })
      .notNull()
      .default("0"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    userIdIdx: index("otp_requests_user_id_idx").on(t.userId),
    purposeIdx: index("otp_requests_purpose_idx").on(t.purpose),
    expiresAtIdx: index("otp_requests_expires_at_idx").on(t.expiresAt),
  }),
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorAdminId: uuid("actor_admin_id"),
    actorRole: text("actor_role"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    success: boolean("success").notNull().default(true),
    reason: text("reason"),
    before: jsonb("before"),
    after: jsonb("after"),
    requestId: text("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    actionIdx: index("audit_logs_action_idx").on(t.action),
    actorIdx: index("audit_logs_actor_idx").on(t.actorAdminId),
    createdAtIdx: index("audit_logs_created_at_idx").on(t.createdAt),
  }),
);

export const payouts = pgTable(
  "payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => wallets.id, { onDelete: "cascade" }),

    reference: text("reference").notNull(),
    amount: numeric("amount", { precision: 20, scale: 8 }).notNull(),
    currencyCode: text("currency_code").notNull(),

    destinationBankCode: text("destination_bank_code").notNull(),
    destinationAccountNumber: text("destination_account_number").notNull(),
    destinationAccountName: text("destination_account_name").notNull(),

    status: text("status").notNull().default("PENDING"),
    provider: text("provider"),
    providerReference: text("provider_reference"),
    lastError: text("last_error"),

    attempts: numeric("attempts", { precision: 10, scale: 0 })
      .notNull()
      .default("0"),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    referenceUnique: uniqueIndex("payouts_reference_unique").on(t.reference),
    userIdIdx: index("payouts_user_id_idx").on(t.userId),
    walletIdIdx: index("payouts_wallet_id_idx").on(t.walletId),
    statusIdx: index("payouts_status_idx").on(t.status),
    createdAtIdx: index("payouts_created_at_idx").on(t.createdAt),
  }),
);

export const userVerifications = pgTable(
  "user_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    bvn: text("bvn"),
    bvnSuffix: text("bvn_suffix"),
    bvnStatus: text("bvn_status").notNull().default("PENDING"),
    bvnVerifiedAt: timestamp("bvn_verified_at", { withTimezone: true }),
    bvnProviderReference: text("bvn_provider_reference"),
    bvnFailureReason: text("bvn_failure_reason"),

    nin: text("nin"),
    ninSuffix: text("nin_suffix"),
    ninStatus: text("nin_status").notNull().default("PENDING"),
    ninVerifiedAt: timestamp("nin_verified_at", { withTimezone: true }),
    ninProviderReference: text("nin_provider_reference"),
    ninFailureReason: text("nin_failure_reason"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    userUnique: uniqueIndex("user_verifications_user_unique").on(t.userId),
    userIdIdx: index("user_verifications_user_id_idx").on(t.userId),
    bvnStatusIdx: index("user_verifications_bvn_status_idx").on(t.bvnStatus),
    ninStatusIdx: index("user_verifications_nin_status_idx").on(t.ninStatus),
  }),
);

export const accountUpdateRequests = pgTable(
  "account_update_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestedFields: jsonb("requested_fields").notNull(),
    status: text("status").notNull().default("pending"),
    adminNote: text("admin_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    userIdIdx: index("account_update_requests_user_id_idx").on(t.userId),
    statusIdx: index("account_update_requests_status_idx").on(t.status),
    createdAtIdx: index("account_update_requests_created_at_idx").on(
      t.createdAt,
    ),
  }),
);

export const supportTickets = pgTable(
  "support_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    message: text("message").notNull(),
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    userIdIdx: index("support_tickets_user_id_idx").on(t.userId),
    statusIdx: index("support_tickets_status_idx").on(t.status),
    createdAtIdx: index("support_tickets_created_at_idx").on(t.createdAt),
  }),
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    passwordHash: text("password_hash").notNull(),
    // 6-digit mobile app passcode (hashed); nullable for existing users
    passcodeHash: text("passcode_hash"),
    // 4-digit transaction pin (hashed); nullable for existing users
    transactionPinHash: text("transaction_pin_hash"),
    countryCode: text("country_code")
      .notNull()
      .references(() => countries.code, { onDelete: "restrict" }),
    region: text("region"),
    currencyCode: text("currency_code").notNull(),
    preferredCurrency: text("preferred_currency"),
    complianceRegion: text("compliance_region"),
    dataLocalizationRegion: text("data_localization_region"),
    complianceTier: text("compliance_tier"),
    role: text("role").notNull().default("customer"),
    status: text("status").notNull().default("active"),
    telecomReloadlyEnabled: boolean("telecom_reloadly_enabled")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    emailUnique: uniqueIndex("users_email_unique").on(t.email),
    phoneUnique: uniqueIndex("users_phone_unique").on(t.phone),
    roleIdx: index("users_role_idx").on(t.role),
    countryIdx: index("users_country_code_idx").on(t.countryCode),
    statusIdx: index("users_status_idx").on(t.status),
  }),
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    sessionType: text("session_type").notNull().default("customer"),
    deviceId: text("device_id"),
    revoked: boolean("revoked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdIdx: index("sessions_user_id_idx").on(t.userId),
    typeIdx: index("sessions_type_idx").on(t.sessionType),
    deviceIdIdx: index("sessions_device_id_idx").on(t.deviceId),
    revokedIdx: index("sessions_revoked_idx").on(t.revoked),
  }),
);

export const wallets = pgTable(
  "wallets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    currencyCode: text("currency_code").notNull(),
    availableBalance: numeric("available_balance", { precision: 20, scale: 8 })
      .notNull()
      .default("0"),
    lockedBalance: numeric("locked_balance", { precision: 20, scale: 8 })
      .notNull()
      .default("0"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    userIdIdx: index("wallets_user_id_idx").on(t.userId),
    userCurrencyUnique: uniqueIndex("wallets_user_currency_unique").on(
      t.userId,
      t.currencyCode,
    ),
  }),
);

export const walletLedger = pgTable(
  "wallet_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => wallets.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    currencyCode: text("currency_code").notNull(),
    transactionType: text("transaction_type").notNull(),
    direction: text("direction").notNull(),
    amount: numeric("amount", { precision: 20, scale: 8 }).notNull(),
    balanceBefore: numeric("balance_before", {
      precision: 20,
      scale: 8,
    }).notNull(),
    balanceAfter: numeric("balance_after", {
      precision: 20,
      scale: 8,
    }).notNull(),
    referenceCode: text("reference_code").notNull(),
    relatedOrderId: text("related_order_id"),
    description: text("description").notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    walletIdIdx: index("wallet_ledger_wallet_id_idx").on(t.walletId),
    userIdIdx: index("wallet_ledger_user_id_idx").on(t.userId),
    referenceUnique: uniqueIndex("wallet_ledger_reference_unique").on(
      t.referenceCode,
    ),
    createdAtIdx: index("wallet_ledger_created_at_idx").on(t.createdAt),
  }),
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    eventType: text("event_type").notNull(),
    reference: text("reference").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("received"),
    retryCount: numeric("retry_count", { precision: 10, scale: 0 })
      .notNull()
      .default("0"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    providerRefUnique: uniqueIndex("webhook_events_provider_ref_unique").on(
      t.provider,
      t.reference,
      t.eventType,
    ),
    statusIdx: index("webhook_events_status_idx").on(t.status),
    createdAtIdx: index("webhook_events_created_at_idx").on(t.createdAt),
  }),
);

export const complianceFlags = pgTable(
  "compliance_flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    walletLedgerId: uuid("wallet_ledger_id")
      .notNull()
      .references(() => walletLedger.id, { onDelete: "cascade" }),
    complianceRegion: text("compliance_region").notNull(),
    ruleCode: text("rule_code").notNull(),
    status: text("status").notNull().default("flagged"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdIdx: index("compliance_flags_user_id_idx").on(t.userId),
    ledgerIdUnique: uniqueIndex("compliance_flags_ledger_id_unique").on(
      t.walletLedgerId,
      t.ruleCode,
    ),
  }),
);

export const transactionLimits = pgTable(
  "transaction_limits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    complianceRegion: text("compliance_region").notNull(),
    complianceTier: text("compliance_tier").notNull(),
    currencyCode: text("currency_code").notNull(),
    dailyLimit: numeric("daily_limit", { precision: 20, scale: 8 }).notNull(),
    monthlyLimit: numeric("monthly_limit", {
      precision: 20,
      scale: 8,
    }).notNull(),
    transactionLimit: numeric("transaction_limit", {
      precision: 20,
      scale: 8,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    regionTierUnique: uniqueIndex("transaction_limits_region_tier_unique").on(
      t.complianceRegion,
      t.complianceTier,
      t.currencyCode,
    ),
  }),
);

export const monnifyReservedAccounts = pgTable(
  "monnify_reserved_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => wallets.id, { onDelete: "cascade" }),
    accountReference: text("account_reference").notNull(),
    reservationReference: text("reservation_reference"),
    status: text("status"),
    bankCode: text("bank_code"),
    bankName: text("bank_name"),
    accountNumber: text("account_number"),
    accountName: text("account_name"),
    rawResponse: jsonb("raw_response"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    userIdIdx: index("monnify_reserved_accounts_user_id_idx").on(t.userId),
    walletIdUnique: uniqueIndex(
      "monnify_reserved_accounts_wallet_id_unique",
    ).on(t.walletId),
    accountReferenceUnique: uniqueIndex(
      "monnify_reserved_accounts_account_reference_unique",
    ).on(t.accountReference),
  }),
);

export const telecomTransactions = pgTable(
  "telecom_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => wallets.id, { onDelete: "cascade" }),

    internalReference: text("internal_reference").notNull(),

    provider: text("provider").notNull(),
    providerReference: text("provider_reference"),

    productType: text("product_type").notNull(),
    network: text("network").notNull(),
    mobileNumber: text("mobile_number").notNull(),
    planCode: text("plan_code"),

    amount: numeric("amount", { precision: 20, scale: 8 }).notNull(),
    status: text("status").notNull(),

    requestPayload: jsonb("request_payload"),
    providerResponse: jsonb("provider_response"),
    lastError: text("last_error"),

    attempts: numeric("attempts", { precision: 10, scale: 0 })
      .notNull()
      .default("0"),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    internalReferenceUnique: uniqueIndex(
      "telecom_transactions_internal_reference_unique",
    ).on(t.internalReference),
    userIdIdx: index("telecom_transactions_user_id_idx").on(t.userId),
    walletIdIdx: index("telecom_transactions_wallet_id_idx").on(t.walletId),
    statusIdx: index("telecom_transactions_status_idx").on(t.status),
    nextRetryAtIdx: index("telecom_transactions_next_retry_at_idx").on(
      t.nextRetryAt,
    ),
  }),
);

export const trainingRegistrations = pgTable(
  "training_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    emailPhoneUnique: uniqueIndex(
      "training_registrations_email_phone_unique",
    ).on(t.email, t.phone),
    createdAtIdx: index("training_registrations_created_at_idx").on(
      t.createdAt,
    ),
  }),
);
