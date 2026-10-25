import {
  findWebhookEvent,
  updateWebhookEventStatus,
  incrementWebhookRetry,
} from "../repository/webhook.repository.js";

import type { WebhookJobData } from "../queues/webhook.queues.js";

import { runComplianceCheckAfterCredit } from "../../wallet/service/wallet.service.js";
import { logger } from "../../../core/logger/logger.js";

type MonnifyEventData = {
  userId?: string;
  currencyCode?: string;
  amountPaid?: string;
  transactionReference?: string;
};

type MonnifyWebhookPayload = {
  eventData?: MonnifyEventData;
  transactionReference?: string;
};

export async function processPaymentWebhook(
  job: WebhookJobData,
): Promise<void> {
  const {
    webhookEventId,
    provider,
    eventType,
    reference,
    payload,
  } = job;

  const event = await findWebhookEvent({
    provider,
    reference,
    eventType,
  });

  if (!event) {
    logger.warn(
      {
        webhookEventId,
        provider,
        reference,
        eventType,
      },
      "payment_webhook_event_not_found",
    );
    return;
  }

  await updateWebhookEventStatus({
    id: event.id,
    status: "processing",
  });

  try {
    switch (provider) {
      case "monnify":
        await processMonnifyWebhook(payload);
        break;

      default:
        logger.warn(
          {
            provider,
            eventType,
          },
          "payment_webhook_provider_not_implemented",
        );
    }

    await updateWebhookEventStatus({
      id: event.id,
      status: "completed",
      processedAt: new Date(),
    });
  } catch (err) {
    logger.error(
      {
        err,
        webhookEventId,
        provider,
        reference,
      },
      "payment_webhook_processing_failed",
    );

    await incrementWebhookRetry(event.id);

    await updateWebhookEventStatus({
      id: event.id,
      status: "failed",
    });

    // Throw so the SQS worker does NOT delete the message.
    // It will become visible again after the visibility timeout
    // and SQS will retry automatically.
    throw err;
  }
}

async function processMonnifyWebhook(
  payload: unknown,
): Promise<unknown> {
  const { handleMonnifyWebhook } = await import(
    "../../monnify/service/monnify.webhook.js"
  );

  const result = await handleMonnifyWebhook(payload);

  if (!result.idempotent && result.balanceAfter) {
    const typedPayload = payload as MonnifyWebhookPayload;

    const eventData = typedPayload.eventData;

    const userId = eventData?.userId;
    const currencyCode = eventData?.currencyCode;
    const amount = eventData?.amountPaid;

    const reference =
      eventData?.transactionReference ??
      typedPayload.transactionReference;

    if (userId && currencyCode && amount && reference) {
      await runComplianceCheckAfterCredit({
        userId,
        currencyCode,
        amount,
        referenceCode: reference,
      }).catch((err: unknown) => {
        logger.warn(
          {
            err,
            userId,
            reference,
          },
          "compliance_check_failed",
        );
      });
    }
  }

  return result;
}