import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./client.js";
import { logger } from "../logger/logger.js";

export async function migrateLatest(): Promise<void> {
  const started = Date.now();
  logger.info("migrations_start");
  try {
    await migrate(db, { migrationsFolder: "drizzle" });
    const ms = Date.now() - started;
    logger.info({ ms }, "migrations_complete");
  } catch (err) {
    logger.error({ err }, "migrations_failed");
    throw err;
  }
}
