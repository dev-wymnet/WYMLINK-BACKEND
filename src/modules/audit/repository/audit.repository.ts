import { db } from "../../../core/db/client.js";
import { auditLogs } from "../../../core/db/schema.js";

export type AuditLogInsert = typeof auditLogs.$inferInsert;

export async function insertAuditLog(input: AuditLogInsert) {
  await db.insert(auditLogs).values({
    ...input,
    createdAt: input.createdAt ?? new Date(),
  });
}
