import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "../../../core/db/client.js";
import { supportMessages, supportTickets, users } from "../../../core/db/schema.js";
import { NotFoundError } from "../../../core/errors/NotFoundError.js";

// Ticket status (db check): open (waiting for WymNet) | awaiting_customer | resolved | closed.
export type TicketStatus = "open" | "awaiting_customer" | "resolved" | "closed";
export type RelatedType = "vtu_order" | "payout" | "transfer" | "deposit" | "ledger";

// A ticket and its first message are created together. A ticket can point at the payment
// it's about ("Report a problem" on a receipt).
export async function createSupportTicket(input: {
  userId: string;
  subject: string;
  message: string;
  relatedType?: RelatedType | undefined;
  relatedId?: string | undefined;
}) {
  return db.transaction(async (tx) => {
    const [ticket] = await tx
      .insert(supportTickets)
      .values({ userId: input.userId, subject: input.subject, relatedType: input.relatedType ?? null, relatedId: input.relatedId ?? null })
      .returning();
    await tx.insert(supportMessages).values({ ticketId: ticket!.id, authorId: input.userId, body: input.message });
    return { ...ticket!, message: input.message };
  });
}

type Thread = { id: string; body: string; fromCustomer: boolean; createdAt: Date };

async function threads(ticketIds: string[], customerOf: (ticketId: string) => string) {
  const out = new Map<string, Thread[]>();
  if (!ticketIds.length) return out;
  const messages = await db.select().from(supportMessages).where(inArray(supportMessages.ticketId, ticketIds)).orderBy(asc(supportMessages.createdAt));
  for (const m of messages) {
    const list = out.get(m.ticketId) ?? [];
    list.push({ id: m.id, body: m.body, fromCustomer: m.authorId === customerOf(m.ticketId), createdAt: m.createdAt });
    out.set(m.ticketId, list);
  }
  return out;
}

export async function listMySupportTickets(userId: string) {
  const tickets = await db.select().from(supportTickets).where(eq(supportTickets.userId, userId)).orderBy(desc(supportTickets.updatedAt));
  const byTicket = await threads(
    tickets.map((t) => t.id),
    () => userId,
  );
  return tickets.map((t) => {
    const thread = byTicket.get(t.id) ?? [];
    return { ...t, message: thread[0]?.body ?? "", messages: thread };
  });
}

// The customer writes in their own ticket; it goes back to waiting for WymNet.
export async function addCustomerMessage(input: { userId: string; ticketId: string; body: string }) {
  await db.transaction(async (tx) => {
    const [t] = await tx
      .select()
      .from(supportTickets)
      .where(and(eq(supportTickets.id, input.ticketId), eq(supportTickets.userId, input.userId)))
      .for("update");
    if (!t) throw new NotFoundError("Ticket not found");
    await tx.insert(supportMessages).values({ ticketId: t.id, authorId: input.userId, body: input.body });
    await tx.update(supportTickets).set({ status: "open", updatedAt: new Date() }).where(eq(supportTickets.id, t.id));
  });
}

// ---------- Staff ----------

const withCustomer = { t: supportTickets, firstName: users.firstName, lastName: users.lastName, email: users.email, phone: users.phone };

export async function listTicketsForStaff(input: { status?: TicketStatus | undefined; limit: number }) {
  const rows = await db
    .select(withCustomer)
    .from(supportTickets)
    .innerJoin(users, eq(users.id, supportTickets.userId))
    .where(input.status ? eq(supportTickets.status, input.status) : sql`true`)
    .orderBy(desc(supportTickets.updatedAt))
    .limit(input.limit);
  return rows.map((r) => ({ ...r.t, customer: { name: `${r.firstName} ${r.lastName}`.trim(), email: r.email, phone: r.phone } }));
}

export async function getTicketForStaff(ticketId: string) {
  const [row] = await db.select(withCustomer).from(supportTickets).innerJoin(users, eq(users.id, supportTickets.userId)).where(eq(supportTickets.id, ticketId)).limit(1);
  if (!row) throw new NotFoundError("Ticket not found");
  const byTicket = await threads([row.t.id], () => row.t.userId);
  return {
    ...row.t,
    customer: { id: row.t.userId, name: `${row.firstName} ${row.lastName}`.trim(), email: row.email, phone: row.phone },
    messages: byTicket.get(row.t.id) ?? [],
  };
}

// Staff reply: the ticket then waits for the customer, or is resolved.
export async function addStaffMessage(input: { staffId: string; ticketId: string; body: string; resolve?: boolean | undefined }) {
  await db.transaction(async (tx) => {
    const [t] = await tx.select().from(supportTickets).where(eq(supportTickets.id, input.ticketId)).for("update");
    if (!t) throw new NotFoundError("Ticket not found");
    await tx.insert(supportMessages).values({ ticketId: t.id, authorId: input.staffId, body: input.body });
    await tx
      .update(supportTickets)
      .set({ status: input.resolve ? "resolved" : "awaiting_customer", updatedAt: new Date() })
      .where(eq(supportTickets.id, t.id));
  });
  return getTicketForStaff(input.ticketId);
}

export async function setTicketStatus(ticketId: string, status: TicketStatus) {
  const [t] = await db.update(supportTickets).set({ status, updatedAt: new Date() }).where(eq(supportTickets.id, ticketId)).returning();
  if (!t) throw new NotFoundError("Ticket not found");
  return getTicketForStaff(ticketId);
}
