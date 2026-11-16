import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  PORT: z.coerce.number().int().positive().default(3000),

  CORS_ORIGIN: z.string().default("*"),

  PROCESS_ROLE: z.enum(["api", "worker", "all"]).default("all"),

  DATABASE_URL: z.string().min(1),

  PG_POOL_MAX: z.coerce.number().int().positive().default(10),

  JWT_ACCESS_SECRET: z.string().min(32),

  // Keys the HMAC stored for BVN/NIN (one identity per account). Never change
  // it once customers have verified: existing hashes would stop matching.
  KYC_HASH_SECRET: z.string().min(32),

  JWT_ACCESS_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60),

  REFRESH_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24),

  // Mobile app sessions (passcode-locked on the device). Default 30 days.
  MOBILE_REFRESH_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 30),

  // Providers below are optional at boot: a feature whose provider is not
  // configured answers "not available yet" when used.

  // Moneta (api.moneta.ng: BVN; app.moneta.ng partner API: virtual accounts).
  // Moneta only accepts calls from whitelisted IPs: MONETA_PROXY_URL routes
  // them through a fixed-IP HTTP proxy (e.g. Fixie) when set.
  MONETA_API_URL: z.string().url().default("https://api.moneta.ng"),
  MONETA_PARTNER_URL: z.string().url().default("https://app.moneta.ng/api/v1"),
  MONETA_BVN_CLIENT_ID: z.string().default(""),
  MONETA_BVN_CLIENT_SECRET: z.string().default(""),
  MONETA_BVN_SERVICE_KEY: z.string().default(""),
  MONETA_PARTNER_CLIENT_ID: z.string().default(""),
  MONETA_PARTNER_CLIENT_SECRET: z.string().default(""),
  MONETA_PROXY_URL: z.string().default(""),
  // Same as MONETA_PROXY_URL (some hosts reject that name); either works.
  MONETA_PROXY: z.string().default(""),
  // Payment-gateway service token. Not sent on partner VA calls (Moneta's docs and
  // Etico's live integration use client id/secret only); kept for when it is needed.
  MONETA_SERVICE_TOKEN: z.string().default(""),
  // Moneta's charge per bank payout (naira), taken from the customer's VA on top of
  // the amount. Shown to the customer before they confirm; the actual charge Moneta
  // reports is what the ledger finally records.
  MONETA_PAYOUT_FEE: z.coerce.number().min(0).max(1000).default(30),

  // Automatic collections (modules/admin/collections/autoCollect.ts): once a day, from this
  // hour (Lagos time), collect from every customer who owes at least AUTO_COLLECT_MIN_OWED,
  // up to AUTO_COLLECT_DAILY_MAX in total (naira). Nothing runs without a collection account.
  AUTO_COLLECT_ENABLED: z
    .union([z.literal("true"), z.literal("false")])
    .default("true")
    .transform((v) => v === "true"),
  AUTO_COLLECT_HOUR: z.coerce.number().int().min(0).max(23).default(1),
  AUTO_COLLECT_MIN_OWED: z.coerce.number().min(100).max(1_000_000).default(1000),
  AUTO_COLLECT_DAILY_MAX: z.coerce.number().min(0).max(100_000_000).default(500_000),
  // How often the backend checks whether the day's run is due (seconds).
  AUTO_COLLECT_CHECK_SECONDS: z.coerce.number().int().min(5).max(3600).default(600),
  // Email the team when Peyflex reports a balance below this (naira). 0 = never.
  PEYFLEX_LOW_BALANCE: z.coerce.number().min(0).default(20_000),
  // Who gets these emails (comma-separated). Empty: every active finance and super admin.
  OPS_ALERT_EMAILS: z.string().default(""),

  PEYFLEX_BASE_URL: z.string().url().default("https://client.peyflex.com.ng"),

  PEYFLEX_API_TOKEN: z.string().default(""),

  RELOADLY_API_CLIENT: z.string().default(""),

  RELOADLY_API_SECRET: z.string().default(""),

  RELOADLY_ENV: z.enum(["sandbox", "production"]).default("sandbox"),

  TELECOM_RETRY_INTERVAL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60),

  // SMTP settings for email OTP
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  SMTP_SECURE: z
    .union([z.literal("true"), z.literal("false")])
    .default("true")
    .transform((v) => v === "true"),
  SMTP_FROM: z.string().default(""),

  // OTP + PIN policies
  OTP_LENGTH: z.coerce.number().int().positive().default(6),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  OTP_RESEND_SECONDS: z.coerce.number().int().positive().default(60),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),

  PASSCODE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  PASSCODE_LOCK_SECONDS: z.coerce.number().int().positive().default(300),
  TX_PIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  TX_PIN_LOCK_SECONDS: z.coerce.number().int().positive().default(300),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);
