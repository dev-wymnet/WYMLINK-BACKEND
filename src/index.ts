import { env } from "./core/config/env.js";
import { config } from "./core/config/index.js";
import { logger } from "./core/logger/logger.js";
import { createServer } from "./server.js";
import { checkPostgresConnection } from "./core/db/health.js";
import { pool } from "./core/db/pool.js";
import { migrateLatest } from "./core/db/migrate.js";
import { Server } from "http";

async function bootstrap() {
  await checkPostgresConnection();
  logger.info("postgres_connected");

  if (!config.ADMIN_MFA_REQUIRED) logger.warn("admin_mfa_switched_off: staff sign in with a password only (ADMIN_MFA_REQUIRED=false)");

  if (config.DB_MIGRATE_ON_START) {
    await migrateLatest();
  }

  const isApi = env.PROCESS_ROLE === "api" || env.PROCESS_ROLE === "all";

  const isWorker = env.PROCESS_ROLE === "worker" || env.PROCESS_ROLE === "all";

  let server: Server | null = null;
  let retryTimer: NodeJS.Timeout | null = null;

  if (isWorker) {
    logger.info("worker_started");
  }

  if (isApi) {
    const app = createServer();

    server = app.listen(env.PORT, () => {
      logger.info(
        {
          port: env.PORT,
          env: env.NODE_ENV,
        },
        "server_started",
      );
    });
  }

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutdown_started");

    if (server) {
      await new Promise<void>((resolve) => {
        server!.close(() => resolve());
      });
    }

    if (retryTimer) {
      clearInterval(retryTimer);
    }

    await pool.end();

    logger.info({ signal }, "shutdown_completed");

    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

bootstrap().catch((err) => {
  logger.fatal({ err }, "bootstrap_failed");

  process.exit(1);
});
