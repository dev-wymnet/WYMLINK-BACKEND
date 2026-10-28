import type { RequestHandler } from "express";

import { generateArchitectureSummary } from "../service/architectureSummary.service.js";
import { config } from "../../../core/config/index.js";
import { env } from "../../../core/config/env.js";
import { pool } from "../../../core/db/pool.js";
import { getReadiness } from "../../../core/health/readiness.js";

export const architectureSummaryHandler: RequestHandler = async (_req, res) => {
  const summary = generateArchitectureSummary();
  res.status(200).json(summary);
};

// Whether settings are present, never any part of a secret.
export const debugEnvHandler: RequestHandler = async (_req, res) => {
  res.status(200).json({
    nodeEnv: env.NODE_ENV,
    processRole: env.PROCESS_ROLE,
    port: env.PORT,
    databaseUrl: {
      present: Boolean(env.DATABASE_URL),
    },
    jwt: {
      accessSecret: { present: Boolean(env.JWT_ACCESS_SECRET) },
    },
  });
};

export const debugDbHandler: RequestHandler = async (_req, res) => {
  const result: any = {
    ok: true,
    checks: {
      ping: null as null | boolean,
      usersTable: null as null | boolean,
    },
    errors: [] as Array<{ check: string; message: string }>,
  };

  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
      result.checks.ping = true;

      const usersColumns = await client.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'users' ORDER BY ordinal_position",
      );

      result.checks.usersTable = usersColumns.rows.length > 0;
      result.usersColumns = usersColumns.rows.map((r: any) => r.column_name);
    } finally {
      client.release();
    }
  } catch (err: any) {
    result.ok = false;
    result.checks.ping = false;
    result.errors.push({
      check: "db",
      message: err?.message ?? String(err),
    });
  }

  res.status(result.ok ? 200 : 500).json(result);
};

export const debugReadinessHandler: RequestHandler = async (_req, res) => {
  try {
    const readiness = await getReadiness();
    res.status(200).json(readiness);
  } catch (err: any) {
    res.status(500).json({
      status: "error",
      message: err?.message ?? String(err),
    });
  }
};
