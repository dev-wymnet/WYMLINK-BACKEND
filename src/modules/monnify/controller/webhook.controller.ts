import type { RequestHandler } from "express";

import { env } from "../../../core/config/env.js";
import { config } from "../../../core/config/index.js";
import { logger } from "../../../core/logger/logger.js";
import { verifyMonnifyWebhookSignature } from "../service/monnify.webhook.js";
import {
  ingestWebhook,
  getQueueNameForProvider,
} from "../../webhooks/service/webhook.service.js";

export const monnifyWebhookHandler: RequestHandler = async (req, res, next) => {
  try {
    const signature = req.get("monnify-signature") ?? undefined;

    // Allow unsigned webhooks ONLY in non-production AND when explicitly enabled AND when using a sandbox Monnify base URL
    const allowUnsigned =
      process.env.MONNIFY_WEBHOOK_ALLOW_UNSIGNED === "true" &&
      config.NODE_ENV !== "production" &&
      /sandbox/i.test(config.MONNIFY_BASE_URL);

    logger.info(
      {
        requestId: (req as any).id,
        path: req.originalUrl || req.url,
        method: req.method,
        hasSignature: Boolean(signature),
        hasRawBody: Boolean((req as any).rawBody),
        allowUnsigned,
      },
      "monnify_webhook_received",
    );

    if (!allowUnsigned) {
      verifyMonnifyWebhookSignature({
        rawBody: (req as any).rawBody,
        signatureHeader: signature,
        clientSecretKey: env.MONNIFY_SECRET_KEY,
      });
      logger.info(
        { requestId: (req as any).id },
        "monnify_webhook_signature_validated",
      );
    } else {
      logger.warn(
        { requestId: (req as any).id },
        "monnify_webhook_unsigned_allowed_in_sandbox",
      );
    }

    const payload = req.body;
    const eventData = payload?.eventData ?? payload?.data ?? {};
    const transactionReference =
      eventData?.transactionReference ?? payload?.transactionReference;
    const paymentReference =
      eventData?.paymentReference ?? payload?.paymentReference;
    const productReference = eventData?.product?.reference;
    const accountReference = eventData?.accountReference ?? productReference;
    const amount = eventData?.amountPaid ?? eventData?.amount ?? null;
    const paymentStatus = eventData?.paymentStatus ?? null;

    logger.info(
      {
        requestId: (req as any).id,
        transactionReference,
        paymentReference,
        accountReference,
        productReference,
        amount,
        paymentStatus,
      },
      "monnify_webhook_payload_extracted",
    );

    const reference =
      transactionReference || paymentReference || productReference || "unknown";

    const result = await ingestWebhook({
      provider: "monnify",
      eventType: "transaction",
      reference,
      payload,
      queueName: getQueueNameForProvider("monnify"),
    });

    logger.info(
      {
        requestId: (req as any).id,
        eventId: result.eventId,
        idempotent: result.idempotent,
      },
      "monnify_webhook_enqueued",
    );

    res.status(200).json({ ok: true, result });
  } catch (err) {
    logger.error({ err, requestId: (req as any).id }, "monnify_webhook_failed");
    next(err);
  }
};

export const monnifyWebhookDebugHandler: RequestHandler = async (
  req,
  res,
  _next,
) => {
  // DO NOT perform any DB, queue, or Monnify operations here.
  const headers = { ...req.headers } as Record<string, unknown>;
  // Redact obvious auth-like headers if present
  delete (headers as any).authorization;
  delete (headers as any)["x-api-key"];

  let parsedBody: any = undefined;
  try {
    parsedBody = req.body;
  } catch {
    parsedBody = undefined;
  }

  const rawBody = (req as any).rawBody as Buffer | undefined;

  logger.info(
    {
      ts: new Date().toISOString(),
      requestId: (req as any).id,
      method: req.method,
      path: req.originalUrl || req.url,
      headers,
      userAgent: req.get("user-agent"),
      remoteAddress: (req as any).ip,
      xForwardedFor: req.get("x-forwarded-for"),
      xForwardedProto: req.get("x-forwarded-proto"),
      cfConnectingIp: req.get("cf-connecting-ip"),
      cfIpCountry: req.get("cf-ipcountry"),
      renderIp: req.get("x-render-ip") || req.get("x-request-id"),
      contentType: req.get("content-type"),
      contentLength: req.get("content-length"),
      hasRawBody: Boolean(rawBody),
      rawBodyLength: rawBody ? rawBody.length : 0,
      // Include key Monnify fields if present
      transactionReference:
        parsedBody?.eventData?.transactionReference ||
        parsedBody?.transactionReference,
      paymentReference:
        parsedBody?.eventData?.paymentReference || parsedBody?.paymentReference,
      accountReference:
        parsedBody?.eventData?.accountReference ||
        parsedBody?.eventData?.product?.reference,
      eventType: parsedBody?.eventType,
      amount:
        parsedBody?.eventData?.amountPaid ||
        parsedBody?.eventData?.amount ||
        parsedBody?.amount,
      paymentStatus: parsedBody?.eventData?.paymentStatus,
      payloadSample: parsedBody,
    },
    "MONNIFY_DEBUG_WEBHOOK_RECEIVED",
  );

  res.status(200).json({ received: true });
};
