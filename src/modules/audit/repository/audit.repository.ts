import { db } from "../../../core/db/client.js";
import { auditLog } from "../../../core/db/schema.js";
import { safeIp } from "../../../core/utils/identity.js";

export type AuditLogInsert = typeof auditLog.$inferInsert;

// The audit log is append-only (enforced by a trigger).
export async function insertAuditLog(input: AuditLogInsert) {
  await db.insert(auditLog).values({ ...input, ip: safeIp(input.ip), userAgent: input.userAgent?.slice(0, 400) ?? null });
}
