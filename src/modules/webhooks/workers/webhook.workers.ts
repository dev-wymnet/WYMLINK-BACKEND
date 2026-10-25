import {
  startWebhookPolling,
  WEBHOOK_QUEUE_NAMES,
} from "../queues/webhook.queues.js";

import { processPaymentWebhook } from "../processors/payments.processor.js";
import { logger } from "../../../core/logger/logger.js";

export function startWebhookWorkers() {
  void startWebhookPolling(
    WEBHOOK_QUEUE_NAMES.PAYMENTS,
    processPaymentWebhook,
  );

  logger.info("webhook_workers_started");

  return {
    async close() {
      logger.info("webhook_workers_stopped");
    },
  };
}