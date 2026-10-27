// Drizzle mapping of the Wymlink schema (db/migrations/0001_wymlink_core.sql).
// The SQL file is the source of truth: constraints, triggers and app.post_entry()
// live there. Balances and ledger lines must only change through
// app.post_entry (see modules/wallet/repository/wallet.repository.ts).
import {
  pgSchema,
  uuid,
  text,
  timestamp,
  boolean,
  numeric,
  jsonb,
  integer,
  smallint,
  date,
  primaryKey,
} from "drizzle-orm/pg-core";

export const app = pgSchema("app");

const ts = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => numeric(name, { precision: 18, scale: 2 });

export const users = app.table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  emailVerifiedAt: ts("email_verified_at"),
  phoneVerifiedAt: ts("phone_verified_at"),
  passwordHash: text("password_hash").notNull(),
  transactionPinHash: text("transaction_pin_hash"),
  passcodeHash: text("passcode_hash"),
  role: text("role").notNull().default("customer"),
  status: text("status").notNull().default("active"),
  kycTier: smallint("kyc_tier").notNull().default(0),
  reloadlyEnabled: boolean("reloadly_enabled").notNull().default(false),
  lastLoginAt: ts("last_login_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  closedAt: ts("closed_at"),
});

export const sessions = app.table("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  kind: text("kind").notNull(), // web | mobile | admin
  refreshTokenHash: text("refresh_token_hash").notNull(),
  previousTokenHash: text("previous_token_hash"),
  deviceId: text("device_id"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  expiresAt: ts("expires_at").notNull(),
  lastUsedAt: ts("last_used_at").notNull().defaultNow(),
  revokedAt: ts("revoked_at"),
  revokedReason: text("revoked_reason"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const pinAttempts = app.table(
  "pin_attempts",
  {
    userId: uuid("user_id").notNull(),
    kind: text("kind").notNull(), // transaction_pin | passcode
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: ts("locked_until"),
    lastFailedAt: ts("last_failed_at"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind] })],
);

export const otpCodes = app.table("otp_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  purpose: text("purpose").notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: ts("expires_at").notNull(),
  consumedAt: ts("consumed_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const kycProfiles = app.table("kyc_profiles", {
  userId: uuid("user_id").primaryKey(),
  bvnHash: text("bvn_hash"),
  bvnLast4: text("bvn_last4"),
  bvnStatus: text("bvn_status").notNull().default("none"), // none | pending | verified | failed
  bvnVerifiedAt: ts("bvn_verified_at"),
  // Encrypted BVN, held only until the Moneta account is opened (0003_kyc_sealed_bvn.sql).
  bvnSealed: text("bvn_sealed"),
  ninHash: text("nin_hash"),
  ninLast4: text("nin_last4"),
  ninStatus: text("nin_status").notNull().default("none"),
  ninVerifiedAt: ts("nin_verified_at"),
  legalFirstName: text("legal_first_name"),
  legalLastName: text("legal_last_name"),
  dateOfBirth: date("date_of_birth"),
  provider: text("provider"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const kycAttempts = app.table("kyc_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  kind: text("kind").notNull(), // bvn | nin | bvn_account_match
  outcome: text("outcome").notNull(), // started | otp_sent | verified | failed | error
  provider: text("provider").notNull(),
  providerReference: text("provider_reference"),
  failureReason: text("failure_reason"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const tierLimits = app.table("tier_limits", {
  tier: smallint("tier").primaryKey(),
  label: text("label").notNull(),
  singleMax: money("single_max").notNull(),
  dailyMax: money("daily_max").notNull(),
  balanceMax: money("balance_max"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const wallets = app.table("wallets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  currencyCode: text("currency_code").notNull().default("NGN"),
  availableBalance: money("available_balance").notNull().default("0"),
  status: text("status").notNull().default("active"), // active | frozen | closed
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const walletLedger = app.table("wallet_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  walletId: uuid("wallet_id").notNull(),
  userId: uuid("user_id").notNull(),
  entryType: text("entry_type").notNull(),
  direction: text("direction").notNull(), // credit | debit
  amount: money("amount").notNull(),
  balanceBefore: money("balance_before").notNull(),
  balanceAfter: money("balance_after").notNull(),
  reference: text("reference").notNull(),
  relatedType: text("related_type"),
  relatedId: uuid("related_id"),
  description: text("description").notNull(),
  metadata: jsonb("metadata"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const virtualAccounts = app.table("virtual_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  walletId: uuid("wallet_id").notNull(),
  provider: text("provider").notNull(),
  providerReference: text("provider_reference").notNull(),
  accountNumber: text("account_number").notNull(),
  accountName: text("account_name").notNull(),
  bankName: text("bank_name").notNull(),
  status: text("status").notNull().default("active"),
  raw: jsonb("raw"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const deposits = app.table("deposits", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  walletId: uuid("wallet_id").notNull(),
  virtualAccountId: uuid("virtual_account_id").notNull(),
  provider: text("provider").notNull(),
  providerReference: text("provider_reference").notNull(),
  amount: money("amount").notNull(),
  fee: money("fee").notNull().default("0"),
  senderName: text("sender_name"),
  senderBank: text("sender_bank"),
  senderAccountLast4: text("sender_account_last4"),
  status: text("status").notNull().default("detected"),
  ledgerEntryId: uuid("ledger_entry_id"),
  raw: jsonb("raw"),
  detectedAt: ts("detected_at").notNull().defaultNow(),
  creditedAt: ts("credited_at"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const providerTokens = app.table("provider_tokens", {
  provider: text("provider").primaryKey(),
  token: text("token").notNull(),
  expiresAt: ts("expires_at"),
  mintedAt: ts("minted_at").notNull().defaultNow(),
  lockUntil: ts("lock_until"),
});

export const providerEvents = app.table("provider_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  eventId: text("event_id").notNull(),
  eventType: text("event_type").notNull(),
  reference: text("reference"),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("received"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  receivedAt: ts("received_at").notNull().defaultNow(),
  processedAt: ts("processed_at"),
});

export const vtuOrders = app.table("vtu_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  walletId: uuid("wallet_id").notNull(),
  reference: text("reference").notNull(),
  product: text("product").notNull(), // airtime | data | cable | electricity | intl_airtime
  provider: text("provider").notNull(), // peyflex | reloadly
  service: text("service").notNull(),
  planCode: text("plan_code"),
  planName: text("plan_name"),
  recipient: text("recipient").notNull(),
  recipientName: text("recipient_name"),
  meterType: text("meter_type"),
  amount: money("amount").notNull(),
  fee: money("fee").notNull().default("0"),
  status: text("status").notNull().default("pending"), // pending | processing | success | failed | refunded | unknown
  providerReference: text("provider_reference"),
  token: text("token"),
  units: text("units"),
  providerResponse: jsonb("provider_response"),
  lastError: text("last_error"),
  attempts: integer("attempts").notNull().default(0),
  nextCheckAt: ts("next_check_at"),
  debitEntryId: uuid("debit_entry_id"),
  refundEntryId: uuid("refund_entry_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  completedAt: ts("completed_at"),
});

export const beneficiaries = app.table("beneficiaries", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  bankCode: text("bank_code").notNull(),
  bankName: text("bank_name").notNull(),
  accountNumber: text("account_number").notNull(),
  accountName: text("account_name").notNull(),
  nickname: text("nickname"),
  lastUsedAt: ts("last_used_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const payouts = app.table("payouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  walletId: uuid("wallet_id").notNull(),
  reference: text("reference").notNull(),
  amount: money("amount").notNull(),
  fee: money("fee").notNull().default("0"),
  beneficiaryBankCode: text("beneficiary_bank_code").notNull(),
  beneficiaryBankRef: text("beneficiary_bank_ref"),
  beneficiaryBankName: text("beneficiary_bank_name"),
  beneficiaryAccountNumber: text("beneficiary_account_number").notNull(),
  beneficiaryAccountName: text("beneficiary_account_name").notNull(),
  narration: text("narration").notNull(),
  provider: text("provider").notNull(),
  providerReference: text("provider_reference"),
  status: text("status").notNull().default("pending"), // pending | processing | success | failed | reversed | unknown
  lastError: text("last_error"),
  attempts: integer("attempts").notNull().default(0),
  nextCheckAt: ts("next_check_at"),
  debitEntryId: uuid("debit_entry_id"),
  reversalEntryId: uuid("reversal_entry_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  completedAt: ts("completed_at"),
});

export const supportTickets = app.table("support_tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  subject: text("subject").notNull(),
  status: text("status").notNull().default("open"),
  relatedType: text("related_type"),
  relatedId: uuid("related_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const supportMessages = app.table("support_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id").notNull(),
  authorId: uuid("author_id").notNull(),
  body: text("body").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const accountUpdateRequests = app.table("account_update_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  requestedFields: jsonb("requested_fields").notNull(),
  status: text("status").notNull().default("pending"),
  reviewedBy: uuid("reviewed_by"),
  adminNote: text("admin_note"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const complianceFlags = app.table("compliance_flags", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  subjectType: text("subject_type").notNull(), // user | deposit | vtu_order | payout
  subjectId: uuid("subject_id").notNull(),
  ruleCode: text("rule_code").notNull(),
  status: text("status").notNull().default("open"),
  metadata: jsonb("metadata"),
  reviewedBy: uuid("reviewed_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const auditLog = app.table("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorUserId: uuid("actor_user_id"),
  actorRole: text("actor_role"),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  success: boolean("success").notNull().default(true),
  reason: text("reason"),
  before: jsonb("before"),
  after: jsonb("after"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  requestId: text("request_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const trainingRegistrations = app.table("training_registrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const updateSubscribers = app.table("update_subscribers", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  source: text("source").notNull().default("website"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const transfers = app.table("transfers", {
  id: uuid("id").primaryKey().defaultRandom(),
  reference: text("reference").notNull(),
  senderUserId: uuid("sender_user_id").notNull(),
  senderWalletId: uuid("sender_wallet_id").notNull(),
  recipientUserId: uuid("recipient_user_id").notNull(),
  recipientWalletId: uuid("recipient_wallet_id").notNull(),
  amount: money("amount").notNull(),
  narration: text("narration"),
  provider: text("provider").notNull().default("moneta"),
  providerReference: text("provider_reference"),
  status: text("status").notNull().default("processing"), // processing | success | reversed | unknown
  lastError: text("last_error"),
  debitEntryId: uuid("debit_entry_id"),
  creditEntryId: uuid("credit_entry_id"),
  reversalEntryId: uuid("reversal_entry_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  completedAt: ts("completed_at"),
});
