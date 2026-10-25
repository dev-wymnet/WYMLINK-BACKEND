import { and, desc, eq, or, sql } from "drizzle-orm";

import { db } from "../../../../core/db/client.js";
import { users } from "../../../../core/db/schema.js";

export async function findAdminById(id: string) {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listAdmins(input: { limit?: number; search?: string }) {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  if (input.search) {
    const term = `%${input.search}%`;
    return db
      .select()
      .from(users)
      .where(
        or(
          sql`${users.role} IN ('super_admin','business_admin','finance_admin') AND ${users.email} ILIKE ${term}`,
          sql`${users.role} IN ('super_admin','business_admin','finance_admin') AND ${users.firstName} ILIKE ${term}`,
          sql`${users.role} IN ('super_admin','business_admin','finance_admin') AND ${users.lastName} ILIKE ${term}`,
        ),
      )
      .orderBy(desc(users.createdAt))
      .limit(limit);
  }
  return db
    .select()
    .from(users)
    .where(sql`${users.role} IN ('super_admin','business_admin','finance_admin')`)
    .orderBy(desc(users.createdAt))
    .limit(limit);
}

export async function countActiveSuperAdminsTx(tx: any) {
  const rows = await tx
    .select({ c: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, "super_admin"), eq(users.status, "active")));
  return rows[0]?.c ?? 0;
}

export async function setUserRoleTx(tx: any, userId: string, role: string) {
  await tx.update(users).set({ role }).where(eq(users.id, userId));
}

export async function setUserStatusTx(tx: any, userId: string, status: string) {
  await tx.update(users).set({ status }).where(eq(users.id, userId));
}
