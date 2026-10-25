import { env } from "../../../core/config/env.js";
import { logger } from "../../../core/logger/logger.js";
import {
  findPayoutByReference,
  updatePayoutStatusAtomic,
} from "../repository/payout.repository.js";
import {
  monnifyCreateSingleDisbursement,
  monnifyGetSingleDisbursementSummary,
} from "../../monnify/client/monnify.client.js";
import { creditWalletAtomic } from "../../wallet/repository/wallet.repository.js";
import { parseMoneyToCents } from "../../../core/utils/money.js";
import { addJobToQueue } from "../../../core/queue/queue.registry.js";
import { Worker, type Job } from "bullmq";
import { getRedisConnections } from "../../../core/queue/queue.factory.js";

const PAYOUTS_QUEUE = "payouts" as const;
const PAYOUT_JOB = "process-payout" as const;

export async function enqueuePayout(input: {
  reference: string;
  userId: string;
}) {
  await addJobToQueue(
    PAYOUTS_QUEUE,
    PAYOUT_JOB,
    { reference: input.reference, userId: input.userId },
    {
      jobId: `payout-${input.reference}`,
      attempts: 5,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 1000,
      removeOnFail: false,
    },
  );
}

async function processPayoutMessage(body: string) {
  const msg = JSON.parse(body) as { reference?: string; userId?: string };
  if (!msg.reference) return;

  const payout = await findPayoutByReference(msg.reference);
  if (!payout) return;

  if (
    payout.status === "SUCCESS" ||
    payout.status === "FAILED" ||
    payout.status === "REVERSED"
  ) {
    return;
  }

  const claimed = await updatePayoutStatusAtomic({
    id: payout.id,
    fromStatuses: ["PENDING", "PROCESSING"],
    toStatus: "PROCESSING",
  });
  if (!claimed) return; // already claimed by another worker

  try {
    const amount = Number(payout.amount);
    const resp = await monnifyCreateSingleDisbursement({
      amount,
      reference: payout.reference,
      narration: "Wallet payout",
      destinationBankCode: payout.destinationBankCode,
      destinationAccountNumber: payout.destinationAccountNumber,
      destinationAccountName: payout.destinationAccountName,
      currency: payout.currencyCode,
      sourceAccountNumber: env.MONNIFY_SOURCE_ACCOUNT_NUMBER,
      async: true,
    });

    const status =
      (resp as any)?.responseBody?.status ??
      (resp as any)?.responseBody?.transactionStatus;

    if (status === "SUCCESS" || status === "COMPLETED") {
      await updatePayoutStatusAtomic({
        id: payout.id,
        fromStatuses: ["PROCESSING"],
        toStatus: "SUCCESS",
        providerReference:
          (resp as any)?.responseBody?.transactionReference ?? null,
      });
      return;
    }

    // Pending-like states: leave as PROCESSING and rely on reconciliation
    await updatePayoutStatusAtomic({
      id: payout.id,
      fromStatuses: ["PROCESSING"],
      toStatus: "PROCESSING",
      providerReference:
        (resp as any)?.responseBody?.transactionReference ?? null,
    });
  } catch (err) {
    // On error, try reconcile by reference; if clearly failed/reversed, refund once
    try {
      const summary = await monnifyGetSingleDisbursementSummary(
        payout.reference,
      );
      const body = (summary as any)?.responseBody ?? {};
      const status = body.status ?? body.transactionStatus;

      if (status === "SUCCESS" || status === "COMPLETED") {
        await updatePayoutStatusAtomic({
          id: payout.id,
          fromStatuses: ["PROCESSING"],
          toStatus: "SUCCESS",
          providerReference: body.transactionReference ?? null,
        });
        return;
      }

      if (
        status === "FAILED" ||
        status === "REVERSED" ||
        status === "EXPIRED"
      ) {
        await updatePayoutStatusAtomic({
          id: payout.id,
          fromStatuses: ["PROCESSING"],
          toStatus: status,
        });
        const amountCents = parseMoneyToCents(String(payout.amount));
        await creditWalletAtomic({
          walletId: payout.walletId,
          userId: payout.userId,
          amountCents,
          referenceCode: `payout_refund_${payout.reference}`,
          transactionType: "refund",
          description: "Payout refund",
          relatedOrderId: payout.reference,
        });
        return;
      }

      // Unknown -> leave for retry
    } catch (e) {
      // swallow; will be retried by SQS
    }
  }
}

export function startPayoutWorkers() {
  const { connection } = getRedisConnections();
  const worker = new Worker(
    PAYOUTS_QUEUE,
    async (job: Job) => {
      if (job.name === PAYOUT_JOB) {
        await processPayoutMessage(JSON.stringify(job.data));
      }
    },
    { connection: connection as any, concurrency: 2, autorun: true },
  );

  logger.info("payout_workers_started");

  return {
    async close() {
      await worker.close();
      logger.info("payout_workers_stopped");
    },
  };
}
