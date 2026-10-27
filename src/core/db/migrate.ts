import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "./pool.js";
import { logger } from "../logger/logger.js";

// Applies db/migrations/*.sql in name order, each once, each in its own
// transaction. Applied files are recorded in public.wymlink_migrations.
const MIGRATIONS_DIR = path.resolve(process.cwd(), "db/migrations");

// Re-applied on every boot, so a table added by any migration is locked down too. The
// database is Supabase: its API roles (anon, authenticated) must never reach Wymlink data.
// RLS is on with no policies (= no rows for those roles) and their grants are revoked; the
// backend connects as the table owner, which RLS doesn't restrict. The migrations table
// lives in `public` (exposed by Supabase's API), so it gets the same treatment.
const LOCKDOWN = `
do $$
declare t record;
begin
  for t in select schemaname, tablename from pg_tables where schemaname = 'app' or (schemaname = 'public' and tablename = 'wymlink_migrations') loop
    execute format('alter table %I.%I enable row level security', t.schemaname, t.tablename);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on %I.%I from anon', t.schemaname, t.tablename);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on %I.%I from authenticated', t.schemaname, t.tablename);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema app from anon';
    execute 'alter default privileges in schema app revoke all on tables from anon';
    execute 'alter default privileges in schema app revoke all on sequences from anon';
    execute 'alter default privileges in schema app revoke all on functions from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema app from authenticated';
    execute 'alter default privileges in schema app revoke all on tables from authenticated';
    execute 'alter default privileges in schema app revoke all on sequences from authenticated';
    execute 'alter default privileges in schema app revoke all on functions from authenticated';
  end if;
end $$;`;

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
    await client.query(LOCKDOWN);
    logger.info({ ms: Date.now() - started }, "migrations_complete");
  } catch (err) {
    logger.error({ err }, "migrations_failed");
    throw err;
  } finally {
    await client.query("select pg_advisory_unlock(hashtext('wymlink_migrations'))").catch(() => undefined);
    client.release();
  }
}
