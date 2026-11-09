import { and, desc, eq, sql, type SQL } from "drizzle-orm";

import { db } from "../../core/db/client.js";
import { promoEvents, users, vtuOrders } from "../../core/db/schema.js";
import { AppError } from "../../core/errors/AppError.js";
import { NotFoundError } from "../../core/errors/NotFoundError.js";
import { ValidationError } from "../../core/errors/ValidationError.js";
import { logger } from "../../core/logger/logger.js";
import { centsToMoneyString, parseMoneyToCents } from "../../core/utils/money.js";
import { insertAuditLog } from "../audit/repository/audit.repository.js";
import { peyflex } from "../vtu/providers/peyflex.js";

// Free-purchase events (db/migrations/0010_events_businesses_codes.sql).
//
// While an event is active, a purchase the customer marks as free (`promo: true`) is paid
// by WymNet: the order is recorded with the event's id and nothing touches the wallet.
// Each customer AND each recipient (phone number, smartcard) gets the event's allowances:
// data and airtime up to a naira total, and the listed base TV plans a set number of times.
// An optional budget caps what the whole event can cost. Ending the event (the kill switch)
// stops new free purchases at once; a purchase marked free is then refused, never charged.

export type PromoEvent = typeof promoEvents.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class PromoUnavailableError extends AppError {
  constructor(message: string) {
    super(message, { statusCode: 400, code: "PROMO_UNAVAILABLE" });
    this.name = "PromoUnavailableError";
  }
}

export type PromoClaim =
  | { product: "data" | "airtime"; recipient: string; amountCents: bigint }
  | { product: "cable"; provider: string; planCode: string; recipient: string; amountCents: bigint };

const naira = (cents: bigint) => `₦${Number(centsToMoneyString(cents)).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;

// Orders that use up an allowance: delivered, or possibly delivered. Failed ones don't.
const COUNTED = sql`status in ('processing', 'pending', 'success', 'unknown')`;

async function usage(ex: Tx | typeof db, eventId: string, where: SQL) {
  const r = await ex.execute(sql`
    select coalesce(sum(amount), 0)::numeric(18,2)::text as total, count(*)::int as n
      from app.vtu_orders
     where promo_event_id = ${eventId}::uuid and ${COUNTED} and ${where}`);
  const row = r.rows[0] as { total: string; n: number };
  return { total: parseMoneyToCents(row.total), count: Number(row.n) };
}

// Checks the purchase against the running event's allowances and returns the event's id.
// Runs inside the order's transaction. Concurrency: the customer and the recipient are each
// locked (transaction advisory locks), so two purchases for the same person or the same
// phone/smartcard are checked one after the other, while different customers don't wait on
// each other. After the order is inserted, commitPromo adds it to the event's running total
// in one short row update that also re-checks the budget and that the event is still on
// (the kill switch), so neither can be overrun by purchases racing each other.
export async function claimPromo(tx: Tx, userId: string, claim: PromoClaim): Promise<string> {
  const rows = await tx.execute(sql`select * from app.promo_events where active`);
  const ev = rows.rows[0] as Record<string, any> | undefined;
  if (!ev) throw new PromoUnavailableError("The free event has ended. Nothing was charged.");
  const eventId = String(ev.id);
  if (claim.product !== "data" && claim.product !== "airtime" && claim.product !== "cable") {
    throw new PromoUnavailableError("This purchase isn't part of the free event.");
  }
  if (claim.product === "cable" && !((ev.tv_plans as string[]) ?? []).includes(claim.planCode)) {
    throw new PromoUnavailableError("Only the base plan of each TV provider is free during the event.");
  }

  // One customer, one recipient at a time (always in this order: no lock cycles).
  await tx.execute(sql`
    select pg_advisory_xact_lock(hashtextextended(${`promo:user:${userId}`}, 0)),
           pg_advisory_xact_lock(hashtextextended(${`promo:recipient:${claim.recipient}`}, 0))`);

  // Everything this customer and this recipient have used so far, in one read (taken after
  // the locks, so it includes any purchase that held them before).
  const provider = claim.product === "cable" ? claim.provider : "";
  const u = (
    await tx.execute(sql`
      select coalesce(sum(amount) filter (where user_id = ${userId}::uuid and product = ${claim.product}), 0)::numeric(18,2)::text as mine_total,
             coalesce(sum(amount) filter (where recipient = ${claim.recipient} and product = ${claim.product}), 0)::numeric(18,2)::text as theirs_total,
             count(*) filter (where user_id = ${userId}::uuid and product = 'cable' and service = ${provider})::int as mine_tv,
             count(*) filter (where recipient = ${claim.recipient} and product = 'cable')::int as card_tv
        from app.vtu_orders
       where promo_event_id = ${eventId}::uuid and ${COUNTED} and (user_id = ${userId}::uuid or recipient = ${claim.recipient})`)
  ).rows[0] as { mine_total: string; theirs_total: string; mine_tv: number; card_tv: number };

  if (claim.product === "data" || claim.product === "airtime") {
    const max = parseMoneyToCents(String(claim.product === "data" ? ev.data_max : ev.airtime_max));
    const label = claim.product === "data" ? "data" : "airtime";
    const left = max - parseMoneyToCents(u.mine_total);
    if (claim.amountCents > left) {
      throw new PromoUnavailableError(
        left <= 0n
          ? `You've used your free ${label} allowance (${naira(max)}).`
          : `You have ${naira(left)} of free ${label} left. Choose a smaller amount.`,
      );
    }
    const leftFor = max - parseMoneyToCents(u.theirs_total);
    if (claim.amountCents > leftFor) {
      throw new PromoUnavailableError(
        leftFor <= 0n
          ? `This number has already received its free ${label} allowance.`
          : `This number has ${naira(leftFor)} of free ${label} left.`,
      );
    }
  } else {
    const perProvider = Number(ev.tv_per_provider);
    if (Number(u.mine_tv) >= perProvider) {
      throw new PromoUnavailableError(`You've already used your free ${provider.toUpperCase()} subscription.`);
    }
    if (Number(u.card_tv) >= perProvider) {
      throw new PromoUnavailableError("This smartcard has already had its free subscription.");
    }
  }
  return eventId;
}

// The last step before the free order's transaction commits: adds it to the event's running
// total if the event is still on and the budget (if any) covers it. The event row is locked
// only from here to the commit, so purchases queue on it for one short update each.
export async function commitPromo(tx: Tx, eventId: string, amountCents: bigint) {
  const amount = centsToMoneyString(amountCents);
  const done = await tx.execute(sql`
    update app.promo_events set committed = committed + ${amount}::numeric
     where id = ${eventId}::uuid and active and (budget is null or committed + ${amount}::numeric <= budget)
     returning id`);
  if (done.rows.length) return;
  const [ev] = (await tx.execute(sql`select active, committed::text as committed from app.promo_events where id = ${eventId}::uuid`)).rows as Array<{ active: boolean; committed: string }>;
  if (!ev?.active) throw new PromoUnavailableError("The free event has ended. Nothing was charged.");
  logger.warn({ eventId, committed: ev.committed }, "promo_budget_reached");
  throw new PromoUnavailableError("Today's free allowance has all been given out. Nothing was charged.");
}

// A free order that failed gives its share of the budget back (same transaction as closing it).
export async function releasePromo(tx: Tx, eventId: string, amount: string) {
  await tx.execute(sql`update app.promo_events set committed = greatest(committed - ${amount}::numeric, 0) where id = ${eventId}::uuid`);
}

// ---------- TV base plans (names and prices from Peyflex, cached) ----------

type TvPlan = { provider: string; planCode: string; name: string; amount: string };
let tvCache: { until: number; plans: TvPlan[] } | null = null;

export async function tvCatalogue(): Promise<TvPlan[]> {
  if (tvCache && Date.now() < tvCache.until) return tvCache.plans;
  const plans: TvPlan[] = [];
  for (const provider of ["gotv", "dstv", "startimes"]) {
    try {
      for (const p of await peyflex.cablePlans(provider)) {
        const code = String(p.plan_code ?? p.planCode ?? "");
        const amount = Number(p.amount ?? p.price);
        if (!code || !Number.isFinite(amount)) continue;
        plans.push({ provider, planCode: code, name: String(p.display ?? p.name ?? code).slice(0, 120), amount: amount.toFixed(2) });
      }
    } catch (err) {
      logger.warn({ provider, err: (err as Error).message }, "promo_tv_catalogue_failed");
    }
  }
  if (plans.length) tvCache = { until: Date.now() + 10 * 60_000, plans };
  return plans;
}

async function tvPlansOf(ev: PromoEvent) {
  const catalogue = await tvCatalogue().catch(() => []);
  return ev.tvPlans.map((code) => {
    const hit = catalogue.find((p) => p.planCode === code);
    return { provider: hit?.provider ?? code.split("-")[0] ?? code, planCode: code, name: hit?.name ?? code, amount: hit?.amount ?? null };
  });
}

// ---------- Customers ----------

export async function getActiveEvent() {
  const rows = await db.select().from(promoEvents).where(eq(promoEvents.active, true)).limit(1);
  return rows[0] ?? null;
}

// The active event and what this customer has left. Null event: no free purchases now.
export async function myPromo(userId: string) {
  const ev = await getActiveEvent();
  if (!ev) return { event: null, mine: null };
  const data = await usage(db, ev.id, sql`product = 'data' and user_id = ${userId}::uuid`);
  const airtime = await usage(db, ev.id, sql`product = 'airtime' and user_id = ${userId}::uuid`);
  const tvRows = await db.execute(sql`
    select service, count(*)::int as n from app.vtu_orders
     where promo_event_id = ${ev.id}::uuid and ${COUNTED} and product = 'cable' and user_id = ${userId}::uuid
     group by service`);
  const tvUsed: Record<string, number> = {};
  for (const r of tvRows.rows as Array<{ service: string; n: number }>) tvUsed[r.service] = Number(r.n);
  const dataMax = parseMoneyToCents(ev.dataMax);
  const airtimeMax = parseMoneyToCents(ev.airtimeMax);
  const clamp = (v: bigint) => (v > 0n ? v : 0n);
  return {
    event: {
      id: ev.id,
      title: ev.title,
      message: ev.message,
      dataMax: ev.dataMax,
      airtimeMax: ev.airtimeMax,
      tvPlans: await tvPlansOf(ev),
      tvPerProvider: ev.tvPerProvider,
      startedAt: ev.startedAt,
    },
    mine: {
      dataUsed: centsToMoneyString(data.total),
      dataLeft: centsToMoneyString(clamp(dataMax - data.total)),
      airtimeUsed: centsToMoneyString(airtime.total),
      airtimeLeft: centsToMoneyString(clamp(airtimeMax - airtime.total)),
      tvUsed,
    },
  };
}

// ---------- Staff ----------

type Staff = { id: string; role?: string | undefined; ip?: string | undefined; userAgent?: string | undefined };
const audit = (staff: Staff, action: string, targetId: string, after: unknown) =>
  insertAuditLog({
    actorUserId: staff.id,
    actorRole: staff.role ?? null,
    action,
    targetType: "promo_event",
    targetId,
    success: true,
    after: after as any,
    ip: staff.ip ?? null,
    userAgent: staff.userAgent ?? null,
  });

export type EventSettings = {
  title: string;
  message: string;
  dataMax: number;
  airtimeMax: number;
  tvPlans: string[];
  tvPerProvider: number;
  budget: number | null;
};

async function checkTvPlans(codes: string[]) {
  const catalogue = await tvCatalogue();
  if (!catalogue.length) return; // Peyflex unreachable: trust staff, purchases re-check prices
  const unknown = codes.filter((c) => !catalogue.some((p) => p.planCode === c));
  if (unknown.length) throw new ValidationError(`Unknown TV plan: ${unknown.join(", ")}`);
}

export async function startEvent(input: EventSettings, staff: Staff) {
  await checkTvPlans(input.tvPlans);
  let ev: PromoEvent;
  try {
    [ev] = (await db
      .insert(promoEvents)
      .values({
        title: input.title.trim(),
        message: input.message.trim(),
        dataMax: input.dataMax.toFixed(2),
        airtimeMax: input.airtimeMax.toFixed(2),
        tvPlans: input.tvPlans,
        tvPerProvider: input.tvPerProvider,
        budget: input.budget === null ? null : input.budget.toFixed(2),
        startedBy: staff.id,
      })
      .returning()) as [PromoEvent];
  } catch (err: any) {
    if ((err?.code ?? err?.cause?.code) === "23505") throw new ValidationError("An event is already running. End it first.");
    throw err;
  }
  await audit(staff, "PROMO_EVENT_STARTED", ev.id, input);
  logger.warn({ eventId: ev.id }, "promo_event_started");
  return ev;
}

export async function updateEvent(id: string, input: { [K in keyof EventSettings]?: EventSettings[K] | undefined }, staff: Staff) {
  if (input.tvPlans) await checkTvPlans(input.tvPlans);
  const set: Partial<typeof promoEvents.$inferInsert> = {};
  if (input.title !== undefined) set.title = input.title.trim();
  if (input.message !== undefined) set.message = input.message.trim();
  if (input.dataMax !== undefined) set.dataMax = input.dataMax.toFixed(2);
  if (input.airtimeMax !== undefined) set.airtimeMax = input.airtimeMax.toFixed(2);
  if (input.tvPlans !== undefined) set.tvPlans = input.tvPlans;
  if (input.tvPerProvider !== undefined) set.tvPerProvider = input.tvPerProvider;
  if (input.budget !== undefined) set.budget = input.budget === null ? null : input.budget.toFixed(2);
  const [ev] = await db.update(promoEvents).set(set).where(and(eq(promoEvents.id, id), eq(promoEvents.active, true))).returning();
  if (!ev) throw new NotFoundError("This event isn't running");
  await audit(staff, "PROMO_EVENT_UPDATED", id, input);
  return ev;
}

// The kill switch. Free purchases already sent to the provider finish; no new ones start.
export async function endEvent(id: string, staff: Staff) {
  const [ev] = await db
    .update(promoEvents)
    .set({ active: false, endedAt: new Date(), endedBy: staff.id })
    .where(and(eq(promoEvents.id, id), eq(promoEvents.active, true)))
    .returning();
  if (!ev) {
    const [existing] = await db.select().from(promoEvents).where(eq(promoEvents.id, id)).limit(1);
    if (!existing) throw new NotFoundError("Event not found");
    return existing; // already ended: ending twice is harmless
  }
  await audit(staff, "PROMO_EVENT_ENDED", id, { endedAt: ev.endedAt });
  logger.warn({ eventId: id }, "promo_event_ended");
  return ev;
}

export async function eventStats(ev: PromoEvent) {
  const r = await db.execute(sql`
    select product,
           count(*) filter (where status = 'success')::int                                  as delivered,
           coalesce(sum(amount) filter (where status = 'success'), 0)::numeric(18,2)::text   as delivered_amount,
           count(*) filter (where status in ('processing', 'pending', 'unknown'))::int        as pending,
           coalesce(sum(amount) filter (where status in ('processing', 'pending', 'unknown')), 0)::numeric(18,2)::text as pending_amount,
           count(*) filter (where status in ('failed', 'refunded'))::int                      as failed
      from app.vtu_orders where promo_event_id = ${ev.id}::uuid group by product`);
  const byProduct = (r.rows as any[]).map((x) => ({
    product: String(x.product),
    delivered: Number(x.delivered),
    deliveredAmount: String(x.delivered_amount),
    pending: Number(x.pending),
    pendingAmount: String(x.pending_amount),
    failed: Number(x.failed),
  }));
  const people = await db.execute(sql`
    select count(distinct user_id)::int as n from app.vtu_orders where promo_event_id = ${ev.id}::uuid and ${COUNTED}`);
  const committed = byProduct.reduce((a, p) => a + parseMoneyToCents(p.deliveredAmount) + parseMoneyToCents(p.pendingAmount), 0n);
  // Peyflex reports its wallet balance after each purchase.
  const bal = await db.execute(sql`
    select provider_response->>'balance' as balance, completed_at from app.vtu_orders
     where provider = 'peyflex' and status = 'success' and provider_response ? 'balance'
     order by completed_at desc nulls last limit 1`);
  const last = bal.rows[0] as { balance: string | null; completed_at: Date | null } | undefined;
  return {
    byProduct,
    customers: Number((people.rows[0] as { n: number }).n),
    committed: centsToMoneyString(committed),
    budgetLeft: ev.budget === null ? null : centsToMoneyString(parseMoneyToCents(ev.budget) - committed),
    peyflexBalance: last?.balance ?? null,
    peyflexBalanceAt: last?.completed_at ?? null,
  };
}

export function toEventDto(ev: PromoEvent) {
  return {
    id: ev.id,
    title: ev.title,
    message: ev.message,
    dataMax: ev.dataMax,
    airtimeMax: ev.airtimeMax,
    tvPlans: ev.tvPlans,
    tvPerProvider: ev.tvPerProvider,
    budget: ev.budget,
    active: ev.active,
    startedAt: ev.startedAt,
    endedAt: ev.endedAt,
  };
}

export async function eventOverview() {
  const events = await db.select().from(promoEvents).orderBy(desc(promoEvents.startedAt)).limit(10);
  const current = events.find((e) => e.active) ?? events[0] ?? null;
  return {
    active: events.find((e) => e.active) ? toEventDto(events.find((e) => e.active)!) : null,
    current: current ? { ...toEventDto(current), stats: await eventStats(current) } : null,
    past: events.filter((e) => !e.active).map(toEventDto),
    tvCatalogue: await tvCatalogue().catch(() => []),
  };
}

export async function eventOrders(id: string, limit: number) {
  const rows = await db
    .select({ o: vtuOrders, first: users.firstName, last: users.lastName, code: users.customerCode })
    .from(vtuOrders)
    .innerJoin(users, eq(users.id, vtuOrders.userId))
    .where(eq(vtuOrders.promoEventId, id))
    .orderBy(desc(vtuOrders.createdAt))
    .limit(limit);
  return rows.map(({ o, first, last, code }) => ({
    id: o.id,
    customer: `${first} ${last}`.trim(),
    customerCode: code,
    product: o.product,
    service: o.service,
    planName: o.planName,
    recipient: o.recipient,
    amount: o.amount,
    status: o.status === "success" ? "success" : o.status === "failed" || o.status === "refunded" ? "failed" : "pending",
    lastError: o.lastError,
    createdAt: o.createdAt,
  }));
}
