import { desc, eq } from "drizzle-orm";

import { db } from "../../../core/db/client.js";
import { supportTickets } from "../../../core/db/schema.js";

export async function createSupportTicket(input: {
  userId: string;
  subject: string;
  message: string;
}) {
  const rows = await db
    .insert(supportTickets)
    .values({ userId: input.userId, subject: input.subject, message: input.message })
    .returning();
  return rows[0]!;
}

export async function listMySupportTickets(userId: string) {
  return db
    .select()
    .from(supportTickets)
    .where(eq(supportTickets.userId, userId))
    .orderBy(desc(supportTickets.createdAt));
}
