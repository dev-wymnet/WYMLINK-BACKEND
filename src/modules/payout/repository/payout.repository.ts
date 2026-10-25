import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../../../core/db/client.js";
import { payouts } from "../../../core/db/schema.js";

export type PayoutRow = typeof payouts.$inferSelect;

export async function findPayoutByReference(reference: string) {
  const rows = await db.select().from(payouts).where(eq(payouts.reference, reference)).limit(1);
  return rows[0] ?? null;
}

export async function findPayoutById(id: string) {
  const rows = await db.select().from(payouts).where(eq(payouts.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function insertPayout(input: Omit<typeof payouts.$inferInsert, "id" | "createdAt" | "updatedAt">) {
  const rows = await db.insert(payouts).values(input).returning();
  return rows[0] ?? null;
}

export async function updatePayoutStatusAtomic(input: {
  id: string;
  fromStatuses: string[];
  toStatus: string;
  providerReference?: string | null;
  lastError?: string | null;
}) {
  const rows = await db
    .update(payouts)
    .set({
      status: input.toStatus,
      providerReference: input.providerReference ?? null,
      lastError: input.lastError ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(payouts.id, input.id), sql`${payouts.status} = ANY(${input.fromStatuses})`))
    .returning();
  return rows[0] ?? null;
}

export async function listMyPayouts(userId: string, limit = 20) {
  return db
    .select()
    .from(payouts)
    .where(eq(payouts.userId, userId))
    .orderBy(desc(payouts.createdAt))
    .limit(limit);
}
