import { Pool } from "pg";
import { env } from "../config/env.js";
import { config } from "../config/index.js";

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.PG_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: config.PG_SSL ? { rejectUnauthorized: false } : undefined,
  statement_timeout: config.PG_STATEMENT_TIMEOUT_MS,
  query_timeout: config.PG_QUERY_TIMEOUT_MS,
});

