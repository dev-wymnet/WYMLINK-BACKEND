import { eq, and, sql } from "drizzle-orm";

import { db } from "../../../core/db/client.js";
import { webhookEvents } from "../../../core/db/schema.js";

export async function createWebhookEvent(input: {
  provider: string;
  eventType: string;
  reference: string;
  payload: unknown;
}) {
  const rows = await db
    .insert(webhookEvents)
    .values({
      provider: input.provider,
      eventType: input.eventType,
      reference: input.reference,
      payload: input.payload as any,
      status: "received",
      retryCount: "0",
    })
    .onConflictDoNothing({
      target: [
        webhookEvents.provider,
        webhookEvents.reference,
        webhookEvents.eventType,
      ],
    })
    .returning();

  return rows[0] ?? null;
}

export async function findWebhookEvent(input: {
  provider: string;
  reference: string;
  eventType: string;
}) {
  const rows = await db
    .select()
    .from(webhookEvents)
    .where(
      and(
        eq(webhookEvents.provider, input.provider),
        eq(webhookEvents.reference, input.reference),
        eq(webhookEvents.eventType, input.eventType),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function updateWebhookEventStatus(input: {
  id: string;
  status: "processing" | "completed" | "failed" | "dead_letter";
  processedAt?: Date | null;
  retryCount?: number;
}) {
  const set: Record<string, any> = { status: input.status };
  if (input.processedAt !== undefined) set.processedAt = input.processedAt;
  if (input.retryCount !== undefined) set.retryCount = String(input.retryCount);

  const rows = await db
    .update(webhookEvents)
    .set(set)
    .where(eq(webhookEvents.id, input.id))
    .returning();

  return rows[0] ?? null;
}

export async function incrementWebhookRetry(id: string) {
  const rows = await db
    .update(webhookEvents)
    .set({
      retryCount: sql`${webhookEvents.retryCount} + 1`,
    })
    .where(eq(webhookEvents.id, id))
    .returning();

  return rows[0] ?? null;
}
