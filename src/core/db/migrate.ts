import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "./pool.js";
import { logger } from "../logger/logger.js";

// Applies db/migrations/*.sql in name order, each once, each in its own
// transaction. Applied files are recorded in public.wymlink_migrations.
const MIGRATIONS_DIR = path.resolve(process.cwd(), "db/migrations");

export async function migrateLatest(): Promise<void> {
  const started = Date.now();
  logger.info("migrations_start");
  const client = await pool.connect();
  try {
    // One runner at a time across instances.
    await client.query("select pg_advisory_lock(hashtext('wymlink_migrations'))");
    await client.query(
      "create table if not exists public.wymlink_migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    const done = new Set(
      (await client.query<{ name: string }>("select name from public.wymlink_migrations")).rows.map((r) => r.name),
    );
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const body = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      await client.query("begin");
      try {
        await client.query(body);
        await client.query("insert into public.wymlink_migrations (name) values ($1)", [file]);
        await client.query("commit");
        logger.info({ file }, "migration_applied");
      } catch (err) {
        await client.query("rollback").catch(() => undefined);
        throw err;
      }
    }
    logger.info({ ms: Date.now() - started }, "migrations_complete");
  } catch (err) {
    logger.error({ err }, "migrations_failed");
    throw err;
  } finally {
    await client.query("select pg_advisory_unlock(hashtext('wymlink_migrations'))").catch(() => undefined);
    client.release();
  }
}
