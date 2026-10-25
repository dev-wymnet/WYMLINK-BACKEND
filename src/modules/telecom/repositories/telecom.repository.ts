import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "../../../core/db/client.js";
import { telecomTransactions } from "../../../core/db/schema.js";

export type TelecomTransactionStatus =
  | "pending"
  | "success"
  | "failed"
  | "processing";

export async function findTelecomTransactionByInternalReference(
  internalReference: string,
) {
  const rows = await db
    .select()
    .from(telecomTransactions)
    .where(eq(telecomTransactions.internalReference, internalReference))
    .limit(1);

  return rows[0] ?? null;
}

export async function createTelecomTransaction(input: {
  userId: string;
  walletId: string;
  internalReference: string;
  provider: string;
  productType: "airtime" | "data";
  network: string;
  mobileNumber: string;
  planCode?: string | null;
  amount: string;
  status: TelecomTransactionStatus;
  requestPayload: unknown;
}) {
  const rows = await db
    .insert(telecomTransactions)
    .values({
      userId: input.userId,
      walletId: input.walletId,
      internalReference: input.internalReference,
      provider: input.provider,
      providerReference: null,
      productType: input.productType,
      network: input.network,
      mobileNumber: input.mobileNumber,
      planCode: input.planCode ?? null,
      amount: input.amount,
      status: input.status,
      requestPayload: input.requestPayload as any,
      providerResponse: null,
      lastError: null,
    })
    .returning();

  return rows[0] ?? null;
}

export async function updateTelecomTransaction(input: {
  internalReference: string;
  status: TelecomTransactionStatus;
  providerReference?: string | null;
  providerResponse?: unknown;
  lastError?: string | null;
  nextRetryAt?: Date | null;
  attemptsIncrement?: number;
}) {
  const updateSet: Record<string, unknown> = {
    status: input.status,
    providerReference: input.providerReference ?? null,
    providerResponse:
      input.providerResponse === undefined
        ? undefined
        : (input.providerResponse as any),
    lastError: input.lastError ?? null,
    nextRetryAt: input.nextRetryAt ?? null,
    updatedAt: new Date(),
  };

  if (input.attemptsIncrement && input.attemptsIncrement > 0) {
    updateSet.attempts = sql`${telecomTransactions.attempts} + ${input.attemptsIncrement}`;
  }

  const rows = await db
    .update(telecomTransactions)
    .set(updateSet)
    .where(eq(telecomTransactions.internalReference, input.internalReference))
    .returning();

  return rows[0] ?? null;
}

export async function listRetryableTelecomTransactions(input: {
  limit: number;
  now: Date;
}) {
  return db
    .select()
    .from(telecomTransactions)
    .where(
      and(
        or(
          eq(telecomTransactions.status, "pending"),
          eq(telecomTransactions.status, "processing"),
        ),
        or(
          isNull(telecomTransactions.nextRetryAt),
          lt(telecomTransactions.nextRetryAt, input.now),
        ),
      ),
    )
    .orderBy(telecomTransactions.createdAt)
    .limit(input.limit);
}
