import { ValidationError } from "../../../core/errors/ValidationError.js";
import { logger } from "../../../core/logger/logger.js";
import { hmacSha512Hex } from "../../../core/utils/crypto.js";
import crypto from "node:crypto";
import { parseMoneyToCents } from "../../../core/utils/money.js";

import { monnifyVerifyTransaction } from "../client/monnify.client.js";
import { findReservedAccountByAccountReference } from "../repository/monnify.repository.js";
import {
  creditWalletAtomic,
  findLedgerByReference,
} from "../../wallet/repository/wallet.repository.js";

export function verifyMonnifyWebhookSignature(input: {
  rawBody: Buffer | undefined;
  signatureHeader: string | undefined;
  clientSecretKey: string;
}) {
  if (!input.rawBody) throw new ValidationError("Missing raw body");
  if (!input.signatureHeader)
    throw new ValidationError("Missing monnify-signature");
  if (!input.clientSecretKey)
    throw new ValidationError("Missing Monnify client secret");

  const computed = hmacSha512Hex(input.clientSecretKey, input.rawBody);
  const provided = input.signatureHeader.trim().toLowerCase();

  // Optional safe diagnostics (non-sensitive)
  try {
    logger.debug(
      {
        rawBodyLength: input.rawBody.length,
        providedSignatureLength: provided.length,
        computedSignatureLength: computed.length,
        providedPrefix: provided.slice(0, 8),
        computedPrefix: computed.slice(0, 8),
      },
      "monnify_webhook_signature_check",
    );
  } catch {}

  // Timing-safe comparison
  const a = Buffer.from(computed, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new ValidationError("Invalid webhook signature");
  }
}

function extractWebhookReferences(payload: any): {
  transactionReference: string;
  paymentReference?: string;
  accountReference?: string;
} {
  const eventData = payload?.eventData ?? payload?.data ?? payload;

  const transactionReference =
    eventData?.transactionReference ??
    eventData?.transactionHash ??
    payload?.transactionReference;
  const paymentReference =
    eventData?.paymentReference ?? payload?.paymentReference;

  const productRef = eventData?.product?.reference;
  const accountReference = eventData?.accountReference ?? productRef;

  if (!transactionReference)
    throw new ValidationError("Invalid webhook payload");

  const base = { transactionReference: String(transactionReference) };
  const withPaymentReference = paymentReference
    ? { ...base, paymentReference: String(paymentReference) }
    : base;

  if (!accountReference) return withPaymentReference;
  return {
    ...withPaymentReference,
    accountReference: String(accountReference),
  };
}

export async function handleMonnifyWebhook(payload: any) {
  const { transactionReference, paymentReference, accountReference } =
    extractWebhookReferences(payload);

  const existing = await findLedgerByReference(transactionReference);
  if (existing) {
    logger.info(
      { referenceCode: transactionReference },
      "monnify_webhook_duplicate_skipped",
    );
    return { idempotent: true as const, balanceAfter: existing.balanceAfter };
  }

  const verified = await monnifyVerifyTransaction(transactionReference);
  if (!verified) throw new ValidationError("Monnify verification failed");

  logger.info(
    {
      transactionReference,
      paymentReference: verified.paymentReference ?? paymentReference,
      paymentStatus: verified.paymentStatus,
      amountPaid: verified.amountPaid,
    },
    "monnify_transaction_verified",
  );

  if (verified.paymentStatus !== "PAID") {
    throw new ValidationError(
      `Transaction not payable: ${verified.paymentStatus ?? "UNKNOWN"}`,
    );
  }

  if (!verified.amountPaid)
    throw new ValidationError("Verified transaction amount missing");

  const resolvedAccountReference =
    accountReference ?? paymentReference ?? verified.paymentReference;

  if (!resolvedAccountReference)
    throw new ValidationError("Missing account reference");

  const reserved = await findReservedAccountByAccountReference(
    resolvedAccountReference,
  );
  if (!reserved) {
    logger.warn(
      {
        accountReference: resolvedAccountReference,
        transactionReference,
        paymentReference: verified.paymentReference ?? paymentReference,
      },
      "monnify_webhook_unknown_account_reference",
    );
    throw new ValidationError("Unknown reserved account");
  }

  const amountCents = parseMoneyToCents(verified.amountPaid);
  if (amountCents <= 0n) throw new ValidationError("Invalid amount");

  const relatedOrderId = verified.paymentReference ?? paymentReference;

  const result = await creditWalletAtomic({
    walletId: reserved.walletId,
    userId: reserved.userId,
    amountCents,
    referenceCode: transactionReference,
    transactionType: "funding",
    description: "Wallet funding (Monnify)",
    ...(relatedOrderId ? { relatedOrderId } : {}),
  });

  logger.info(
    {
      referenceCode: transactionReference,
      walletId: reserved.walletId,
      userId: reserved.userId,
      idempotent: result.idempotent,
    },
    "monnify_webhook_wallet_credit",
  );

  return result;
}
