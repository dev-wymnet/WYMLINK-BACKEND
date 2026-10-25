import "dotenv/config";
import { z } from "zod";
import { env as baseEnv } from "./env.js";

const extraSchema = z.object({
  SERVICE_NAME: z.string().default("wynmet-backend"),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .optional(),

  REQUEST_JSON_LIMIT: z.string().default("1mb"),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),

  CORS_ORIGINS: z.string().default(""),

  PG_SSL: z
    .union([z.literal("true"), z.literal("false")])
    .default("false")
    .transform((v) => v === "true"),

  PG_STATEMENT_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(0),

  PG_QUERY_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(0),

  DB_MIGRATE_ON_START: z
    .union([z.literal("true"), z.literal("false")])
    .default("false")
    .transform((v) => v === "true"),

  JWT_SECRET: z.string().min(32).optional(),

  JWT_REFRESH_SECRET: z.string().min(32).optional(),

  // Load balancers / proxies in front of this API (Render = 1). Without it every
  // request appears to come from the load balancer and per-IP limits are shared.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),

  // Shared with the web app's server (BFF) so it can pass the real client IP.
  BFF_SHARED_SECRET: z.string().min(32).optional(),
});

const extra = extraSchema.parse(process.env);

function parseCors(origins: string): (string | RegExp)[] | boolean {
  const value = origins.trim();

  // Browsers talk to the web app's own server, never to this API directly, so
  // production allows no cross-site browser access unless origins are listed.
  if (!value) {
    return baseEnv.NODE_ENV === "production" ? false : true;
  }

  const parts = value.split(/[,\s]+/).filter(Boolean);

  return parts.length === 0 ? false : parts;
}

export const config = {
  /**
   * Base Environment
   */

  NODE_ENV: baseEnv.NODE_ENV,
  PORT: baseEnv.PORT,
  PROCESS_ROLE: baseEnv.PROCESS_ROLE,
  CORS_ORIGIN: baseEnv.CORS_ORIGIN,

  DATABASE_URL: baseEnv.DATABASE_URL,
  PG_POOL_MAX: baseEnv.PG_POOL_MAX,

  JWT_ACCESS_SECRET: baseEnv.JWT_ACCESS_SECRET,
  JWT_ACCESS_TTL_SECONDS: baseEnv.JWT_ACCESS_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS: baseEnv.REFRESH_TOKEN_TTL_SECONDS,

  MONNIFY_BASE_URL: baseEnv.MONNIFY_BASE_URL,
  MONNIFY_API_KEY: baseEnv.MONNIFY_API_KEY,
  MONNIFY_SECRET_KEY: baseEnv.MONNIFY_SECRET_KEY,
  MONNIFY_CONTRACT_CODE: baseEnv.MONNIFY_CONTRACT_CODE,

  PEYFLEX_BASE_URL: baseEnv.PEYFLEX_BASE_URL,
  PEYFLEX_API_TOKEN: baseEnv.PEYFLEX_API_TOKEN,

  RELOADLY_API_CLIENT: baseEnv.RELOADLY_API_CLIENT,
  RELOADLY_API_SECRET: baseEnv.RELOADLY_API_SECRET,
  RELOADLY_ENV: baseEnv.RELOADLY_ENV,

  TELECOM_RETRY_INTERVAL_SECONDS: baseEnv.TELECOM_RETRY_INTERVAL_SECONDS,

  /**
   * Redis
   */

  REDIS_URL: baseEnv.REDIS_URL,

  /**
   * Extended Config
   */

  SERVICE_NAME: extra.SERVICE_NAME,

  LOG_LEVEL:
    extra.LOG_LEVEL ?? (baseEnv.NODE_ENV === "production" ? "info" : "debug"),

  REQUEST_JSON_LIMIT: extra.REQUEST_JSON_LIMIT,

  RATE_LIMIT_WINDOW_MS: extra.RATE_LIMIT_WINDOW_MS,

  RATE_LIMIT_MAX: extra.RATE_LIMIT_MAX,

  CORS_ORIGINS: parseCors(extra.CORS_ORIGINS),

  PG_SSL: extra.PG_SSL,

  PG_STATEMENT_TIMEOUT_MS: extra.PG_STATEMENT_TIMEOUT_MS,

  PG_QUERY_TIMEOUT_MS: extra.PG_QUERY_TIMEOUT_MS,

  DB_MIGRATE_ON_START: extra.DB_MIGRATE_ON_START,

  TRUST_PROXY_HOPS: extra.TRUST_PROXY_HOPS,

  BFF_SHARED_SECRET: extra.BFF_SHARED_SECRET,

  /**
   * Backward compatibility
   */

  JWT_SECRET: extra.JWT_SECRET ?? baseEnv.JWT_ACCESS_SECRET,

  JWT_REFRESH_SECRET: extra.JWT_REFRESH_SECRET,

  // SMTP
  SMTP_HOST: baseEnv.SMTP_HOST,
  SMTP_PORT: baseEnv.SMTP_PORT,
  SMTP_USER: baseEnv.SMTP_USER,
  SMTP_PASS: baseEnv.SMTP_PASS,
  SMTP_SECURE: baseEnv.SMTP_SECURE,
  SMTP_FROM: baseEnv.SMTP_FROM,

  // OTP + PIN policies
  OTP_LENGTH: baseEnv.OTP_LENGTH,
  OTP_TTL_SECONDS: baseEnv.OTP_TTL_SECONDS,
  OTP_RESEND_SECONDS: baseEnv.OTP_RESEND_SECONDS,
  OTP_MAX_ATTEMPTS: baseEnv.OTP_MAX_ATTEMPTS,
  PASSCODE_MAX_ATTEMPTS: baseEnv.PASSCODE_MAX_ATTEMPTS,
  PASSCODE_LOCK_SECONDS: baseEnv.PASSCODE_LOCK_SECONDS,
  TX_PIN_MAX_ATTEMPTS: baseEnv.TX_PIN_MAX_ATTEMPTS,
  TX_PIN_LOCK_SECONDS: baseEnv.TX_PIN_LOCK_SECONDS,
} as const;

export type AppConfig = typeof config;
