import { Worker, type Job } from "bullmq";
import { getRedisConnections } from "../../../core/queue/queue.factory.js";
import { addJobToQueue } from "../../../core/queue/queue.registry.js";

export const WEBHOOK_QUEUE_NAMES = {
  PAYMENTS: "payments",
  TELECOM: "telecom",
  NOTIFICATIONS: "notifications",
  COMPLIANCE: "compliance",
} as const;

export type WebhookQueueName =
  (typeof WEBHOOK_QUEUE_NAMES)[keyof typeof WEBHOOK_QUEUE_NAMES];

export type WebhookJobData = {
  webhookEventId: string;
  provider: string;
  eventType: string;
  reference: string;
  payload: unknown;
};

export const WEBHOOK_JOB_NAMES = {
  PAYMENTS_PROCESS: "process-payment-webhook",
} as const;

export async function enqueueWebhook(
  queueName: WebhookQueueName,
  data: WebhookJobData,
) {
  const jobName =
    queueName === WEBHOOK_QUEUE_NAMES.PAYMENTS
      ? WEBHOOK_JOB_NAMES.PAYMENTS_PROCESS
      : "process-webhook";

  await addJobToQueue(queueName, jobName, data, {
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 1000,
    removeOnFail: false,
  });
}

export function startWebhookPolling(
  queueName: WebhookQueueName,
  processor: (job: WebhookJobData) => Promise<void>,
) {
  const { connection } = getRedisConnections();
  const jobName =
    queueName === WEBHOOK_QUEUE_NAMES.PAYMENTS
      ? WEBHOOK_JOB_NAMES.PAYMENTS_PROCESS
      : "process-webhook";

  const worker = new Worker(
    queueName,
    async (job: Job) => {
      if (job.name === jobName) {
        await processor(job.data as WebhookJobData);
      }
    },
    { connection: connection as any, concurrency: 5, autorun: true },
  );

  return worker;
}
