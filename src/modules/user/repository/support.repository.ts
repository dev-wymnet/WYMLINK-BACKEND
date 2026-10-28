import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "../../../core/db/client.js";
import { supportMessages, supportTickets, users } from "../../../core/db/schema.js";
import { NotFoundError } from "../../../core/errors/NotFoundError.js";
import { ReplyConflictError } from "../../../core/errors/AppError.js";

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
    const { assignedTo: _a, assignedAt: _b, ...t } = ticket!;
    return { ...t, message: input.message };
  });
}

// authorName: who wrote a staff message. Customers see the first name only.
type Thread = { id: string; body: string; fromCustomer: boolean; authorName: string | null; createdAt: Date };

async function threads(ticketIds: string[], customerOf: (ticketId: string) => string, fullNames: boolean) {
  const out = new Map<string, Thread[]>();
  if (!ticketIds.length) return out;
  const messages = await db
    .select({ m: supportMessages, firstName: users.firstName, lastName: users.lastName })
    .from(supportMessages)
    .leftJoin(users, eq(users.id, supportMessages.authorId))
    .where(inArray(supportMessages.ticketId, ticketIds))
    .orderBy(asc(supportMessages.createdAt));
  for (const { m, firstName, lastName } of messages) {
    const fromCustomer = m.authorId === customerOf(m.ticketId);
    const name = fromCustomer || !firstName ? null : fullNames ? `${firstName} ${lastName ?? ""}`.trim() : firstName;
    const list = out.get(m.ticketId) ?? [];
    list.push({ id: m.id, body: m.body, fromCustomer, authorName: name, createdAt: m.createdAt });
    out.set(m.ticketId, list);
  }
  return out;
}

export async function listMySupportTickets(userId: string) {
  const tickets = await db.select().from(supportTickets).where(eq(supportTickets.userId, userId)).orderBy(desc(supportTickets.updatedAt));
  const byTicket = await threads(
    tickets.map((t) => t.id),
    () => userId,
    false,
  );
  return tickets.map(({ assignedTo: _a, assignedAt: _b, ...t }) => {
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

type Staff = { id: string; name: string };

const assignee = alias(users, "assignee");
const withCustomer = {
  t: supportTickets,
  firstName: users.firstName,
  lastName: users.lastName,
  email: users.email,
  phone: users.phone,
  assigneeFirst: assignee.firstName,
  assigneeLast: assignee.lastName,
};
const assigneeOf = (r: { t: { assignedTo: string | null }; assigneeFirst: string | null; assigneeLast: string | null }) =>
  r.t.assignedTo ? { id: r.t.assignedTo, name: `${r.assigneeFirst ?? ""} ${r.assigneeLast ?? ""}`.trim() } : null;

// Who has a ticket open in the console right now (per instance; kept fresh by the
// console's polling), so two people don't start answering the same customer.
const VIEWING_MS = 15_000;
const viewing = new Map<string, Map<string, { name: string; at: number }>>();

function noteViewer(ticketId: string, staff: Staff) {
  const now = Date.now();
  const here = viewing.get(ticketId) ?? new Map<string, { name: string; at: number }>();
  here.set(staff.id, { name: staff.name, at: now });
  for (const [id, v] of here) if (now - v.at > VIEWING_MS) here.delete(id);
  viewing.set(ticketId, here);
  if (viewing.size > 5000) viewing.clear();
  return [...here.entries()].filter(([id]) => id !== staff.id).map(([id, v]) => ({ id, name: v.name }));
}

export async function listTicketsForStaff(input: {
  status?: TicketStatus | undefined;
  assigned?: "me" | "unassigned" | undefined;
  staffId: string;
  limit: number;
}) {
  const rows = await db
    .select(withCustomer)
    .from(supportTickets)
    .innerJoin(users, eq(users.id, supportTickets.userId))
    .leftJoin(assignee, eq(assignee.id, supportTickets.assignedTo))
    .where(
      and(
        input.status ? eq(supportTickets.status, input.status) : undefined,
        input.assigned === "me" ? eq(supportTickets.assignedTo, input.staffId) : undefined,
        input.assigned === "unassigned" ? isNull(supportTickets.assignedTo) : undefined,
      ),
    )
    .orderBy(desc(supportTickets.updatedAt))
    .limit(input.limit);
  return rows.map((r) => ({
    ...r.t,
    customer: { name: `${r.firstName} ${r.lastName}`.trim(), email: r.email, phone: r.phone },
    assignee: assigneeOf(r),
  }));
}

export async function getTicketForStaff(ticketId: string, viewer?: Staff) {
  const [row] = await db
    .select(withCustomer)
    .from(supportTickets)
    .innerJoin(users, eq(users.id, supportTickets.userId))
    .leftJoin(assignee, eq(assignee.id, supportTickets.assignedTo))
    .where(eq(supportTickets.id, ticketId))
    .limit(1);
  if (!row) throw new NotFoundError("Ticket not found");
  const byTicket = await threads([row.t.id], () => row.t.userId, true);
  return {
    ...row.t,
    customer: { id: row.t.userId, name: `${row.firstName} ${row.lastName}`.trim(), email: row.email, phone: row.phone },
    assignee: assigneeOf(row),
    otherViewers: viewer ? noteViewer(row.t.id, viewer) : [],
    messages: byTicket.get(row.t.id) ?? [],
  };
}

// Staff reply: the ticket then waits for the customer, or is resolved. `afterMessageId` is
// the last message the staff member saw: if a colleague answered since, the reply is held
// back (409) so the customer doesn't get two answers. An unassigned ticket becomes theirs.
export async function addStaffMessage(input: {
  staff: Staff;
  ticketId: string;
  body: string;
  resolve?: boolean | undefined;
  afterMessageId?: string | undefined;
}) {
  await db.transaction(async (tx) => {
    const [t] = await tx.select().from(supportTickets).where(eq(supportTickets.id, input.ticketId)).for("update");
    if (!t) throw new NotFoundError("Ticket not found");
    if (input.afterMessageId) {
      const newer = await tx
        .select({ authorId: supportMessages.authorId, firstName: users.firstName })
        .from(supportMessages)
        .leftJoin(users, eq(users.id, supportMessages.authorId))
        .where(
          and(
            eq(supportMessages.ticketId, t.id),
            sql`${supportMessages.createdAt} > (select m.created_at from app.support_messages m where m.id = ${input.afterMessageId} and m.ticket_id = ${t.id})`,
          ),
        );
      const colleague = newer.find((m) => m.authorId !== t.userId && m.authorId !== input.staff.id);
      if (colleague) throw new ReplyConflictError(colleague.firstName ?? "Another staff member");
    }
    await tx.insert(supportMessages).values({ ticketId: t.id, authorId: input.staff.id, body: input.body });
    await tx
      .update(supportTickets)
      .set({
        status: input.resolve ? "resolved" : "awaiting_customer",
        updatedAt: new Date(),
        ...(t.assignedTo ? {} : { assignedTo: input.staff.id, assignedAt: new Date() }),
      })
      .where(eq(supportTickets.id, t.id));
  });
  return getTicketForStaff(input.ticketId, input.staff);
}

export async function setTicketStatus(ticketId: string, status: TicketStatus, viewer?: Staff) {
  const [t] = await db.update(supportTickets).set({ status, updatedAt: new Date() }).where(eq(supportTickets.id, ticketId)).returning();
  if (!t) throw new NotFoundError("Ticket not found");
  return getTicketForStaff(ticketId, viewer);
}

// Take a ticket, or let it go. Not a lock: anyone can still reply, but everyone sees who has it.
export async function assignTicket(ticketId: string, staffId: string | null, viewer: Staff) {
  const [t] = await db
    .update(supportTickets)
    .set({ assignedTo: staffId, assignedAt: staffId ? new Date() : null })
    .where(eq(supportTickets.id, ticketId))
    .returning({ id: supportTickets.id });
  if (!t) throw new NotFoundError("Ticket not found");
  return getTicketForStaff(ticketId, viewer);
}
