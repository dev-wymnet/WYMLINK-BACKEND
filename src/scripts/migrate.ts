import { migrateLatest } from "../core/db/migrate.js";
import { logger } from "../core/logger/logger.js";

async function main() {
  logger.info("Starting database migration...");

  await migrateLatest();

  logger.info("Database migration completed.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error(err);
    process.exit(1);
  });