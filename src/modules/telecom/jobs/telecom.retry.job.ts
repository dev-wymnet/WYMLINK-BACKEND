import { logger } from "../../../core/logger/logger.js";
import { parseMoneyToCents } from "../../../core/utils/money.js";

import {
  listRetryableTelecomTransactions,
  updateTelecomTransaction,
} from "../repositories/telecom.repository.js";
import { getTelecomProviderWithPlans } from "../providers/index.js";
import { creditWalletAtomic } from "../../wallet/repository/wallet.repository.js";

export async function runTelecomRetryOnce(input: { limit?: number } = {}) {
  const rows = await listRetryableTelecomTransactions({
    limit: input.limit ?? 20,
    now: new Date(),
  });

  for (const row of rows) {
    try {
      const provider = getTelecomProviderWithPlans(row.provider as any);
      const payload = row.requestPayload as any;

      if (!payload || !payload.type) {
        await updateTelecomTransaction({
          internalReference: row.internalReference,
          status: "failed",
          lastError: "Missing request payload for retry",
          nextRetryAt: null,
        });
        continue;
      }

      await updateTelecomTransaction({
        internalReference: row.internalReference,
        status: "processing",
      });

      const resp =
        payload.type === "airtime"
          ? await provider.purchaseAirtime({
              network: payload.network,
              amount: payload.amount,
              mobileNumber: payload.mobileNumber,
            })
          : await provider.purchaseData({
              network: payload.network,
              mobileNumber: payload.mobileNumber,
              planCode: payload.planCode,
            });

      if (resp.status === "SUCCESS") {
        await updateTelecomTransaction({
          internalReference: row.internalReference,
          status: "success",
          providerReference: resp.providerReference ?? null,
          providerResponse: resp.raw,
          lastError: null,
          nextRetryAt: null,
        });
      } else if (resp.status === "FAILED") {
        const amountCents = parseMoneyToCents(String(row.amount));
        if (amountCents > 0n) {
          await creditWalletAtomic({
            walletId: row.walletId,
            userId: row.userId,
            amountCents,
            referenceCode: `${row.internalReference}:refund`,
            transactionType: "refund",
            description: `Refund: Telecom purchase failed (${row.provider})`,
            relatedOrderId: row.internalReference,
          });
        }

        await updateTelecomTransaction({
          internalReference: row.internalReference,
          status: "failed",
          providerReference: resp.providerReference ?? null,
          providerResponse: resp.raw,
          lastError: resp.message ?? "Provider failed",
          nextRetryAt: null,
        });
      } else {
        const attempts = Number(row.attempts ?? 0) + 1;
        const nextRetryAt = new Date(
          Date.now() + Math.min(15 * 60, 30 * 2 ** (attempts - 1)) * 1000,
        );

        await updateTelecomTransaction({
          internalReference: row.internalReference,
          status: "pending",
          providerReference: resp.providerReference ?? null,
          providerResponse: resp.raw,
          lastError: resp.message ?? "Provider pending",
          nextRetryAt,
          attemptsIncrement: 1,
        });
      }
    } catch (err) {
      logger.warn(
        { internalReference: row.internalReference, err },
        "telecom_retry_failed",
      );

      const attempts = Number(row.attempts ?? 0) + 1;
      const nextRetryAt = new Date(
        Date.now() + Math.min(15 * 60, 30 * 2 ** (attempts - 1)) * 1000,
      );

      await updateTelecomTransaction({
        internalReference: row.internalReference,
        status: "pending",
        lastError: err instanceof Error ? err.message : String(err),
        nextRetryAt,
        attemptsIncrement: 1,
      });
    }
  }

  return { processed: rows.length };
}
