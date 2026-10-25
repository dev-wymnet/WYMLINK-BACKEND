import { desc, eq } from "drizzle-orm";

import { db } from "../../../core/db/client.js";
import { accountUpdateRequests } from "../../../core/db/schema.js";

export async function createAccountUpdateRequest(input: {
  userId: string;
  requestedFields: Record<string, unknown>;
}) {
  const rows = await db
    .insert(accountUpdateRequests)
    .values({ userId: input.userId, requestedFields: input.requestedFields })
    .returning();
  return rows[0]!;
}

export async function listMyAccountUpdateRequests(userId: string) {
  return db
    .select()
    .from(accountUpdateRequests)
    .where(eq(accountUpdateRequests.userId, userId))
    .orderBy(desc(accountUpdateRequests.createdAt));
}
