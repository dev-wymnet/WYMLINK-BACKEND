import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";

import { db } from "../../../../core/db/client.js";
import { users, vtuOrders } from "../../../../core/db/schema.js";
import type { ListBillsDto } from "../types/bills.dto.js";

const escapeLike = (s: string) => s.replace(/[%_\\]/g, (ch) => "\\" + ch);

function where(f: ListBillsDto) {
  const c: SQL[] = [];
  if (f.from) c.push(gte(vtuOrders.createdAt, new Date(f.from)));
  if (f.to) c.push(lte(vtuOrders.createdAt, new Date(f.to)));
  if (f.customerId) c.push(eq(vtuOrders.userId, f.customerId));
  if (f.status === "attention") c.push(inArray(vtuOrders.status, ["unknown", "processing", "pending"]));
  else if (f.status) c.push(eq(vtuOrders.status, f.status));
  if (f.type) c.push(eq(vtuOrders.product, f.type));
  if (f.provider) c.push(eq(vtuOrders.provider, f.provider));
  if (f.search) {
    const like = `%${escapeLike(f.search)}%`;
    c.push(
      or(
        ilike(vtuOrders.reference, like),
        ilike(vtuOrders.providerReference, like),
        ilike(vtuOrders.recipient, like),
        ilike(users.firstName, like),
        ilike(users.lastName, like),
        sql`${users.email}::text ilike ${like}`,
        ilike(users.phone, like),
      )!,
    );
  }
  return c.length ? and(...c) : undefined;
}

export async function listBills(f: ListBillsDto) {
  const dir = f.order === "asc" ? asc : desc;
  return db
    .select({ order: vtuOrders, firstName: users.firstName, lastName: users.lastName })
    .from(vtuOrders)
    .innerJoin(users, eq(users.id, vtuOrders.userId))
    .where(where(f))
    .orderBy(f.sort === "amount" ? dir(vtuOrders.amount) : dir(vtuOrders.createdAt))
    .limit(f.limit)
    .offset((f.page - 1) * f.limit);
}

export async function countBills(f: ListBillsDto) {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(vtuOrders)
    .innerJoin(users, eq(users.id, vtuOrders.userId))
    .where(where(f));
  return row?.c ?? 0;
}

export async function getBillById(id: string) {
  const [row] = await db
    .select({ order: vtuOrders, user: users })
    .from(vtuOrders)
    .innerJoin(users, eq(users.id, vtuOrders.userId))
    .where(eq(vtuOrders.id, id))
    .limit(1);
  return row ?? null;
}
