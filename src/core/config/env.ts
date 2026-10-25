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

  // Optional at boot: features that need a missing provider fail when used,
  // not at startup. Without REDIS_URL the background workers are skipped.

  REDIS_URL: z.string().default(""),

  PG_POOL_MAX: z.coerce.number().int().positive().default(10),

  JWT_ACCESS_SECRET: z.string().min(32),

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

  MONNIFY_BASE_URL: z.string().url().default("https://api.monnify.com"),

  MONNIFY_API_KEY: z.string().default(""),

  MONNIFY_SECRET_KEY: z.string().default(""),

  MONNIFY_CONTRACT_CODE: z.string().default(""),

  MONNIFY_SOURCE_ACCOUNT_NUMBER: z.string().default(""),

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
