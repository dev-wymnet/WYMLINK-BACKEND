import { and, eq, inArray, sql } from "drizzle-orm";

import { env } from "../../../core/config/env.js";
import { db } from "../../../core/db/client.js";
import { auditLog, users } from "../../../core/db/schema.js";
import { sendEmail } from "../../../core/email/email.service.js";
import { escapeHtml } from "../../../core/email/mailer.js";
import { logger } from "../../../core/logger/logger.js";

// Emails to WymNet's own team: automatic collection results, collection account changes,
// a low Peyflex balance. Best effort: a failed email is logged, never thrown.

export const nairaText = (n: number | string) =>
  `₦${Number(n).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// OPS_ALERT_EMAILS when set, otherwise every active finance and super admin.
export async function alertRecipients(): Promise<string[]> {
  const listed = env.OPS_ALERT_EMAILS.split(",").map((s) => s.trim()).filter(Boolean);
  if (listed.length) return [...new Set(listed)];
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(and(inArray(users.role, ["finance_admin", "super_admin"]), eq(users.status, "active")));
  return [...new Set(rows.map((r) => r.email?.trim()).filter((e): e is string => Boolean(e)))];
}

// One paragraph per line; "- " lines become a list.
export async function emailTeam(subject: string, lines: string[]) {
  try {
    const to = await alertRecipients();
    if (!to.length) {
      logger.warn({ subject }, "ops_alert_no_recipients");
      return;
    }
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2933">${lines
      .map((l) => (l.startsWith("- ") ? `<p style="margin:0 0 4px 16px">&bull; ${escapeHtml(l.slice(2))}</p>` : l ? `<p style="margin:0 0 10px">${escapeHtml(l)}</p>` : ""))
      .join("")}</div>`;
    for (const address of to) await sendEmail({ to: address, subject, text: lines.join("\n"), html });
  } catch (err) {
    logger.error({ err: (err as Error).message, subject }, "ops_alert_failed");
  }
}

// True for exactly one caller per `action` since `since`, across restarts and overlapping
// processes (e.g. during a deploy): the claim is an audit-log row written under a lock.
export async function claimOnce(action: string, since: Date, after: unknown): Promise<boolean> {
  return db.transaction(async (tx) => {
    const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${`wymlink:${action}`})) as ok`);
    if (!(lock.rows[0] as { ok?: boolean } | undefined)?.ok) return false;
    const recent = await tx.execute(sql`select 1 from app.audit_log where action = ${action} and created_at >= ${since.toISOString()}::timestamptz limit 1`);
    if (recent.rows.length) return false;
    await tx.insert(auditLog).values({ action, actorRole: "system", targetType: "system", success: true, after: after as any });
    return true;
  });
}
