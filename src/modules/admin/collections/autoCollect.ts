import { and, desc, eq, gte } from "drizzle-orm";

import { env } from "../../../core/config/env.js";
import { db } from "../../../core/db/client.js";
import { auditLog } from "../../../core/db/schema.js";
import { logger } from "../../../core/logger/logger.js";
import { centsToMoneyString, parseMoneyToCents } from "../../../core/utils/money.js";
import { claimOnce, emailTeam, nairaText } from "../alerts/opsAlerts.js";
import { collectFromAll, getCollectionAccount, owedSummary, refreshOpenCollections } from "./collections.service.js";

// Automatic collections: once a day, from AUTO_COLLECT_HOUR (Lagos time), the backend does
// what "Collect from everyone" does, for customers who owe at least AUTO_COLLECT_MIN_OWED,
// up to AUTO_COLLECT_DAILY_MAX in total, then emails the team what happened.
//
// Not a fixed-time cron: Render's free plan sleeps when idle. A timer checks every few
// minutes whether today's run is due, so after a sleep the first check runs it. Each day's
// run is claimed once (claimOnce), so a restart or a second process never repeats it.
//
// Safety: nothing runs without a collection account, nor within 6 hours of it changing
// (every change is emailed to the team), and the daily maximum caps one run.

const SYSTEM = { id: null, role: "system" };
const LAGOS_OFFSET_MS = 3600_000; // West Africa Time: UTC+1 all year
const ACCOUNT_SETTLE_MS = 6 * 3600_000;
const CHECK_MS = () => env.AUTO_COLLECT_CHECK_SECONDS * 1000;

// Today's due time: AUTO_COLLECT_HOUR:00 in Lagos.
export function dueAt(now: Date) {
  const lagos = new Date(now.getTime() + LAGOS_OFFSET_MS);
  return new Date(Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate(), env.AUTO_COLLECT_HOUR) - LAGOS_OFFSET_MS);
}

const lagosLabel = (d: Date) =>
  d.toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export async function maybeRunAutoCollection(now = new Date()) {
  if (!env.AUTO_COLLECT_ENABLED) return { ran: false, reason: "switched off" };
  const due = dueAt(now);
  if (now < due) return { ran: false, reason: "not due yet" };
  const minOwed = parseMoneyToCents(env.AUTO_COLLECT_MIN_OWED.toFixed(2));

  const account = await getCollectionAccount();
  if (!account) {
    await remindNoAccount(due, minOwed);
    return { ran: false, reason: "no collection account" };
  }
  if (now.getTime() - account.createdAt.getTime() < ACCOUNT_SETTLE_MS) return { ran: false, reason: "collection account changed less than 6 hours ago" };
  if (!(await claimOnce("AUTO_COLLECTION_RUN", due, { due: due.toISOString(), accountId: account.id }))) return { ran: false, reason: "already ran today" };

  logger.info({ due: due.toISOString() }, "auto_collection_started");
  const refreshed = await refreshOpenCollections(SYSTEM).catch((err) => {
    logger.warn({ err: (err as Error).message }, "auto_collection_refresh_failed");
    return [];
  });
  const run = await collectFromAll(SYSTEM, { minOwedCents: minOwed, maxTotalCents: parseMoneyToCents(env.AUTO_COLLECT_DAILY_MAX.toFixed(2)) });
  const left = await owedSummary(minOwed);

  const done = run.results.filter((r: any) => !r.skipped && r.collection?.status === "success");
  const waiting = run.results.filter((r: any) => !r.skipped && (r.collection?.status === "unknown" || r.collection?.status === "processing"));
  const failed = run.results.filter((r: any) => !r.skipped && r.collection?.status === "failed");
  const skipped = run.results.filter((r: any) => r.skipped);
  const sum = (rs: any[], k: "sent" | "fee") => centsToMoneyString(rs.reduce((a, r) => a + parseMoneyToCents(r.collection[k]), 0n));
  const summary = {
    collected: { customers: done.length, sent: sum(done, "sent"), fees: sum(done, "fee") },
    waiting: { customers: waiting.length, sent: sum(waiting, "sent") },
    failed: failed.map((r: any) => ({ userId: r.userId, reason: r.collection.lastError })),
    skipped: skipped.map((r: any) => ({ userId: r.userId, reason: r.reason })),
    stoppedAtLimit: run.stoppedAtLimit,
    refreshed: refreshed.length,
    stillOwed: left,
  };
  await db.insert(auditLog).values({ action: "AUTO_COLLECTION_DONE", actorRole: "system", targetType: "collection", success: true, after: summary as any });
  logger.info(summary, "auto_collection_done");

  if (run.attempted > 0 || run.stoppedAtLimit) {
    const lines = [
      `Wymlink collected customers' purchases automatically on ${lagosLabel(now)} (Lagos time).`,
      `Paid to: ${account.accountName}, ${account.bankName} ${account.accountNumber}.`,
      `Collected: ${nairaText(summary.collected.sent)} from ${done.length} customer${done.length === 1 ? "" : "s"} (Moneta's fees: ${nairaText(summary.collected.fees)}).`,
    ];
    if (waiting.length) lines.push(`Waiting for Moneta to confirm: ${nairaText(summary.waiting.sent)} from ${waiting.length} customer${waiting.length === 1 ? "" : "s"}. These are re-checked on the next run, or press "Check with Moneta" on the Collections page.`);
    if (failed.length) {
      lines.push(`Failed, nothing moved: ${failed.length} customer${failed.length === 1 ? "" : "s"}.`);
      for (const r of failed.slice(0, 10) as any[]) lines.push(`- ${r.name}: ${r.collection.lastError ?? "declined"}`);
    }
    if (skipped.length) {
      lines.push(`Skipped: ${skipped.length} customer${skipped.length === 1 ? "" : "s"}.`);
      for (const r of skipped.slice(0, 10) as any[]) lines.push(`- ${r.name}: ${r.reason}`);
    }
    if (run.stoppedAtLimit) lines.push(`Stopped at the daily limit of ${nairaText(env.AUTO_COLLECT_DAILY_MAX)}. The rest is collected on the next run.`);
    if (left.small.customers) {
      const one = left.small.customers === 1;
      lines.push(`Left for later: ${nairaText(left.small.total)} from ${left.small.customers} customer${one ? " who owes" : "s who each owe"} less than ${nairaText(env.AUTO_COLLECT_MIN_OWED)}, so Moneta's fee stays a small share.`);
    }
    lines.push("If this account isn't Peyflex's funding account, move the collected money to Peyflex to refill the balance customers buy from.");
    await emailTeam(`Wymlink automatic collection: ${nairaText(summary.collected.sent)} collected`, lines);
  }
  return { ran: true, ...summary };
}

// No collection account: customers' purchases can't be collected. At most one email a day.
async function remindNoAccount(due: Date, minOwed: bigint) {
  const owed = await owedSummary(minOwed);
  if (!owed.due.customers) return;
  if (!(await claimOnce("AUTO_COLLECTION_NO_ACCOUNT", due, owed))) return;
  await emailTeam("Wymlink: set a collection account so customers' purchases can be collected", [
    `${nairaText(owed.due.total)} that customers spent on purchases is waiting in their Moneta accounts (${owed.due.customers} customer${owed.due.customers === 1 ? "" : "s"} owing ${nairaText(env.AUTO_COLLECT_MIN_OWED)} or more).`,
    "WymNet already paid Peyflex for these purchases. Wymlink collects this money automatically every day, but no collection account is set yet.",
    "A super admin can set it in Admin console → Collections. Collecting starts 6 hours after it is set.",
  ]);
}

// For the admin console: settings, the next run and the last run's summary.
export async function autoCollectionStatus(now = new Date()) {
  const due = dueAt(now);
  const [ranToday] = await db
    .select({ at: auditLog.createdAt })
    .from(auditLog)
    .where(and(eq(auditLog.action, "AUTO_COLLECTION_RUN"), gte(auditLog.createdAt, due)))
    .limit(1);
  const [last] = await db.select().from(auditLog).where(eq(auditLog.action, "AUTO_COLLECTION_DONE")).orderBy(desc(auditLog.createdAt)).limit(1);
  const account = await getCollectionAccount();
  const nextRun = now < due ? due : ranToday ? new Date(due.getTime() + 86_400_000) : now;
  const settlesAt = account ? new Date(account.createdAt.getTime() + ACCOUNT_SETTLE_MS) : null;
  return {
    enabled: env.AUTO_COLLECT_ENABLED,
    hourLagos: env.AUTO_COLLECT_HOUR,
    minOwed: env.AUTO_COLLECT_MIN_OWED.toFixed(2),
    dailyMax: env.AUTO_COLLECT_DAILY_MAX.toFixed(2),
    accountSet: Boolean(account),
    nextRun: env.AUTO_COLLECT_ENABLED && account ? (settlesAt && settlesAt > nextRun ? settlesAt : nextRun) : null,
    lastRun: last ? { at: last.createdAt, summary: last.after } : null,
  };
}

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startAutoCollection() {
  if (!env.AUTO_COLLECT_ENABLED) {
    logger.info("auto_collection_switched_off");
    return;
  }
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await maybeRunAutoCollection();
      if (r.ran) logger.info("auto_collection_finished");
    } catch (err) {
      logger.error({ err: (err as Error).message }, "auto_collection_failed");
    } finally {
      running = false;
    }
  };
  setTimeout(() => void tick(), Math.min(60_000, CHECK_MS())).unref();
  timer = setInterval(() => void tick(), CHECK_MS());
  timer.unref();
  logger.info({ hour: env.AUTO_COLLECT_HOUR, minOwed: env.AUTO_COLLECT_MIN_OWED, dailyMax: env.AUTO_COLLECT_DAILY_MAX }, "auto_collection_scheduled");
}

export function stopAutoCollection() {
  if (timer) clearInterval(timer);
  timer = null;
}
