import { and, desc, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "../../../../core/db/client.js";
import { users } from "../../../../core/db/schema.js";
import type { Executor } from "../../../wallet/repository/wallet.repository.js";

export const STAFF_ROLES = ["super_admin", "business_admin", "finance_admin"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export async function findAdminById(id: string, ex: Executor = db) {
  const rows = await ex.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listAdmins(input: { limit: number; offset: number; search?: string | undefined }) {
  const isStaff = inArray(users.role, [...STAFF_ROLES]);
  const term = input.search ? `%${input.search.replace(/[%_\\]/g, (ch) => "\\" + ch)}%` : null;
  const where = term
    ? and(isStaff, or(sql`${users.email}::text ilike ${term}`, sql`${users.firstName} ilike ${term}`, sql`${users.lastName} ilike ${term}`))
    : isStaff;
  const [rows, [count]] = await Promise.all([
    db.select().from(users).where(where).orderBy(desc(users.createdAt)).limit(input.limit).offset(input.offset),
    db.select({ c: sql<number>`count(*)::int` }).from(users).where(where),
  ]);
  return { rows, total: count?.c ?? 0 };
}

// Locks every active super admin row, so two concurrent changes can't both
// conclude that someone else is still a super admin.
export async function lockActiveSuperAdmins(ex: Executor) {
  const rows = await ex
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "super_admin"), eq(users.status, "active")))
    .for("update");
  return rows.length;
}

export async function setUserRole(ex: Executor, userId: string, role: StaffRole) {
  await ex.update(users).set({ role }).where(eq(users.id, userId));
}

export async function setUserStatus(ex: Executor, userId: string, status: "active" | "disabled") {
  await ex.update(users).set({ status }).where(eq(users.id, userId));
}
