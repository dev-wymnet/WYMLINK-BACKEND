import { asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "../../../core/db/client.js";
import { supportMessages, supportTickets } from "../../../core/db/schema.js";

// A ticket and its first message are created together.
export async function createSupportTicket(input: { userId: string; subject: string; message: string }) {
  return db.transaction(async (tx) => {
    const [ticket] = await tx
      .insert(supportTickets)
      .values({ userId: input.userId, subject: input.subject })
      .returning();
    await tx.insert(supportMessages).values({ ticketId: ticket!.id, authorId: input.userId, body: input.message });
    return { ...ticket!, message: input.message };
  });
}

export async function listMySupportTickets(userId: string) {
  const tickets = await db
    .select()
    .from(supportTickets)
    .where(eq(supportTickets.userId, userId))
    .orderBy(desc(supportTickets.createdAt));
  if (!tickets.length) return [];

  const messages = await db
    .select()
    .from(supportMessages)
    .where(inArray(supportMessages.ticketId, tickets.map((t) => t.id)))
    .orderBy(asc(supportMessages.createdAt));

  return tickets.map((t) => {
    const thread = messages.filter((m) => m.ticketId === t.id);
    return {
      ...t,
      message: thread[0]?.body ?? "",
      messages: thread.map((m) => ({ id: m.id, body: m.body, fromCustomer: m.authorId === userId, createdAt: m.createdAt })),
    };
  });
}
