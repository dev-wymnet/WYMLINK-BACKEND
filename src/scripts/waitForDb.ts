import { pool } from "../core/db/pool.js";
import { logger } from "../core/logger/logger.js";

async function waitForDb() {
  const maxAttempts = Number(process.env.DB_WAIT_MAX_ATTEMPTS ?? "30");
  const delayMs = Number(process.env.DB_WAIT_DELAY_MS ?? "2000");

  logger.info({ maxAttempts, delayMs }, "db_wait_start");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      logger.info({ attempt }, "db_wait_ping");
      await pool.query("SELECT 1");
      logger.info({ attempt }, "db_available");
      return;
    } catch (err) {
      logger.warn({ attempt, err }, "db_wait_retry");
      if (attempt === maxAttempts) {
        logger.error({ err, attempts: maxAttempts }, "db_wait_exhausted");
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

waitForDb()
  .then(() => {
    logger.info("db_wait_done");
    process.exit(0);
  })
  .catch((err) => {
    logger.error({ err }, "db_wait_error");
    process.exit(1);
  });
