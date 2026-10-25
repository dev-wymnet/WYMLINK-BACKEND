import {
  createWebhookEvent,
  findWebhookEvent,
} from "../repository/webhook.repository.js";

import {
  enqueueWebhook,
  WEBHOOK_QUEUE_NAMES,
  type WebhookQueueName,
} from "../queues/webhook.queues.js";

export async function ingestWebhook(input: {
  provider: string;
  eventType: string;
  reference: string;
  payload: unknown;
  queueName: WebhookQueueName;
}) {
  const existing = await findWebhookEvent({
    provider: input.provider,
    reference: input.reference,
    eventType: input.eventType,
  });

  if (existing) {
    return {
      idempotent: true,
      eventId: existing.id,
    };
  }

  const created = await createWebhookEvent({
    provider: input.provider,
    eventType: input.eventType,
    reference: input.reference,
    payload: input.payload,
  });

  if (!created) {
    return {
      idempotent: true,
      eventId: null,
    };
  }

  await enqueueWebhook(input.queueName, {
    webhookEventId: created.id,
    provider: input.provider,
    eventType: input.eventType,
    reference: input.reference,
    payload: input.payload,
  });

  return {
    idempotent: false,
    eventId: created.id,
  };
}

export function getQueueNameForProvider(provider: string): WebhookQueueName {
  switch (provider) {
    case "monnify":
    case "flutterwave":
    case "paystack":
      return WEBHOOK_QUEUE_NAMES.PAYMENTS;

    case "peyflex":
      return WEBHOOK_QUEUE_NAMES.TELECOM;

    default:
      return WEBHOOK_QUEUE_NAMES.PAYMENTS;
  }
}
