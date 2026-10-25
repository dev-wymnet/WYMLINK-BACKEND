import { env } from "./core/config/env.js";
import { config } from "./core/config/index.js";
import { logger } from "./core/logger/logger.js";
import { createServer } from "./server.js";
import { checkPostgresConnection } from "./core/db/health.js";
import { pool } from "./core/db/pool.js";
import { seedCountries } from "./modules/country/service/country.seed.js";
import { runTelecomRetryOnce } from "./modules/telecom/jobs/telecom.retry.job.js";
import { startWebhookWorkers } from "./modules/webhooks/workers/webhook.workers.js";
import { startPayoutWorkers } from "./modules/payout/worker/payout.worker.js";
import { closeAllQueues } from "./core/queue/queue.registry.js";
import { closeRedisConnections } from "./core/queue/queue.factory.js";
import { migrateLatest } from "./core/db/migrate.js";
import { Server } from "http";

async function bootstrap() {
  await checkPostgresConnection();
  logger.info("postgres_connected");

  if (config.DB_MIGRATE_ON_START) {
    await migrateLatest();
  }

  await seedCountries()
    .then(() => logger.info("countries_seeded"))
    .catch((err) => logger.warn({ err }, "countries_seed_skipped"));

  const isApi = env.PROCESS_ROLE === "api" || env.PROCESS_ROLE === "all";

  const isWorker =
    (env.PROCESS_ROLE === "worker" || env.PROCESS_ROLE === "all") &&
    Boolean(env.REDIS_URL);

  if (!env.REDIS_URL) {
    logger.warn("REDIS_URL not set: background workers disabled");
  }

  let server: Server | null = null;
  let retryTimer: NodeJS.Timeout | null = null;
  let payoutWorkerHandle: { close: () => Promise<void> } | null = null;

  if (isWorker) {
    startWebhookWorkers();
    payoutWorkerHandle = startPayoutWorkers();

    retryTimer = setInterval(() => {
      void runTelecomRetryOnce().catch((err) => {
        logger.warn({ err }, "telecom_retry_tick_failed");
      });
    }, env.TELECOM_RETRY_INTERVAL_SECONDS * 1000);

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

    if (payoutWorkerHandle) {
      await payoutWorkerHandle.close().catch(() => undefined);
    }

    await closeAllQueues().catch(() => undefined);
    await closeRedisConnections().catch(() => undefined);

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
