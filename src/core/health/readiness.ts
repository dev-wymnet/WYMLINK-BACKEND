import { pool } from "../db/pool.js";

export type ReadinessStatus = "ok" | "degraded" | "not_ready";
export async function getReadiness(): Promise<{
  status: ReadinessStatus;
  checks: {
    postgres: boolean;
    workers: boolean | null;
  };
  uptimeSeconds: number;
}> {
  let pgOk = false;

  /**
   * PostgreSQL
   */
  try {
    const client = await pool.connect();

    try {
      await client.query("SELECT 1");
      pgOk = true;
    } finally {
      client.release();
    }
  } catch {
    pgOk = false;
  }

  /**
   * Worker health
   * Replace with a real worker heartbeat later if desired.
   */
  const workers = null;

  const status: ReadinessStatus = pgOk ? "ok" : "not_ready";

  return {
    status,
    checks: {
      postgres: pgOk,
      workers,
    },
    uptimeSeconds: Math.floor(process.uptime()),
  };
}
