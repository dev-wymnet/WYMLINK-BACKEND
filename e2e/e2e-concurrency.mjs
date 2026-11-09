// Free event under a conference rush (local backend, database behind a latency proxy that
// mimics live). Checks: different customers don't queue behind each other, shared-recipient
// and budget limits hold under concurrency, the kill switch holds mid-rush, and the event's
// running total always equals what its orders add up to.
const API = "http://localhost:4000/api/v1";
const H = "http://localhost:4591";
let pass = 0, fail = 0;
const ok = (c, label, extra) => { if (c) { pass++; console.log("  ok  ", label); } else { fail++; console.log("  FAIL", label, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : ""); } };
const sql = async (q, params) => (await fetch(`${H}/sql`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sql: q, params }) })).json();
async function call(method, path, token, body) {
  const r = await fetch(`${API}${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
const ref = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const run = Date.now().toString().slice(-5);
const errMsg = (r) => r.json?.error?.message ?? r.json?.message ?? JSON.stringify(r.json);
let seq = 0;
async function customer() {
  const n = String(++seq).padStart(3, "0");
  const phone = `+23470${run}${n}`;
  const r = await call("POST", "/auth/signup", null, { firstName: "Rush", lastName: `C${n}`, email: `rush.${run}.${n}@test.local`, phone, password: "Passw0rd!long" });
  if (!r.json?.accessToken) throw new Error("signup: " + JSON.stringify(r.json));
  await call("POST", "/auth/pin/transaction/set", r.json.accessToken, { pin: "2468" });
  return { token: r.json.accessToken, phone };
}
const data = (c, plan, to) => call("POST", "/telecom/data/purchase", c.token, { internalReference: ref("d"), network: "mtn", planCode: plan, mobileNumber: to, transactionPin: "2468", promo: true });
const totalsMatch = async (eventId) => {
  const r = await sql(`select e.committed::text c, coalesce((select sum(amount) from app.vtu_orders o where o.promo_event_id = e.id and o.status in ('processing','pending','success','unknown')),0)::numeric(18,2)::text s from app.promo_events e where e.id = $1`, [eventId]);
  return { committed: r[0]?.c, orders: r[0]?.s, same: Number(r[0]?.c) === Number(r[0]?.s) };
};

await sql("update app.promo_events set active = false, ended_at = now() where active");
const admin = (await call("POST", "/admin/auth/login", null, { email: "admin@test.local", password: "Admin-Pass-12345!" })).json.accessToken;
const start = await call("POST", "/admin/promo", admin, { title: "Rush", message: "Free today", dataMax: 8000, airtimeMax: 5000, tvPlans: ["gotv-easy", "dstv-starter36"], tvPerProvider: 1, budget: null });
const eventId = start.json?.event?.id;
ok(start.status === 201, "event started", start.json);

console.log("== Creating 40 customers");
const people = [];
for (let i = 0; i < 40; i++) people.push(await customer());
ok(people.length === 40, "40 customers ready");

console.log("== 30 different customers buy at the same moment");
const t0 = Date.now();
const rush = await Promise.all(people.slice(0, 30).map((p) => data(p, "D2500", p.phone)));
const secs = (Date.now() - t0) / 1000;
const delivered = rush.filter((r) => r.json?.transaction?.status === "success").length;
ok(delivered === 30, `all 30 delivered (${secs.toFixed(1)} s for the whole rush)`, rush.filter((r) => r.json?.transaction?.status !== "success").map(errMsg));
ok(secs < 20, "the rush finishes quickly (customers don't queue behind one lock)", secs);
let tm = await totalsMatch(eventId);
ok(tm.same && Number(tm.committed) === 30 * 2500, "running total = ₦75,000 = the orders", tm);

console.log("== 6 customers send free data to ONE phone at once (limit ₦8,000 per number)");
const shared = `+23481${run}999`;
const toOne = await Promise.all(people.slice(30, 36).map((p) => data(p, "D4000", shared)));
const okOne = toOne.filter((r) => r.json?.transaction?.status === "success").length;
ok(okOne === 2, "exactly 2 of 6 delivered to the shared number", toOne.map((r) => r.json?.transaction?.status ?? errMsg(r)));
tm = await totalsMatch(eventId);
ok(tm.same, "running total still equals the orders", tm);

console.log("== Budget under a rush");
const committed = Number((await totalsMatch(eventId)).committed);
await call("PATCH", `/admin/promo/${eventId}`, admin, { budget: committed + 8000 });
const budgetRush = await Promise.all(people.slice(0, 8).map((p, i) => data(p, "D4000", `+23482${run}${String(i).padStart(3, "0")}`)));
const okB = budgetRush.filter((r) => r.json?.transaction?.status === "success").length;
const refusedB = budgetRush.filter((r) => /all been given out/.test(errMsg(r))).length;
ok(okB === 2 && refusedB === 6, "exactly 2 of 8 fit the last ₦8,000 of budget; 6 refused", { okB, refusedB, msgs: budgetRush.map((r) => r.json?.transaction?.status ?? errMsg(r)) });
tm = await totalsMatch(eventId);
ok(tm.same && Number(tm.committed) <= committed + 8000, "budget never exceeded, total equals orders", tm);
await call("PATCH", `/admin/promo/${eventId}`, admin, { budget: null });

console.log("== A failed provider order gives its share back");
const failer = people[36];
const f = await data(failer, "D2500", `+234803${run}0099`);
ok(f.json?.transaction?.status === "failed", "declined order shows failed", f.json);
tm = await totalsMatch(eventId);
ok(tm.same, "running total excludes the failed order", tm);

console.log("== Kill switch in the middle of a rush");
const late = people.slice(36, 40);
const inflight = Promise.all(late.map((p, i) => data(p, "D2500", `+23483${run}${String(i).padStart(3, "0")}`)));
await new Promise((r) => setTimeout(r, 40));
const end = await call("POST", `/admin/promo/${eventId}/end`, admin, {});
const results = await inflight;
ok(end.status === 200, "event ended mid-rush", end.json);
const after = await Promise.all(late.map((p) => data(p, "D500", p.phone)));
ok(after.every((r) => r.status === 400 && /ended/.test(errMsg(r))), "every purchase after the switch is refused", after.map(errMsg));
const endedAt = (await sql("select ended_at from app.promo_events where id = $1", [eventId]))[0].ended_at;
const lateOrders = await sql("select count(*)::int n from app.vtu_orders where promo_event_id = $1 and created_at > $2", [eventId, endedAt]);
ok(lateOrders[0].n === 0, "no free order was created after the switch", lateOrders);
ok(results.every((r) => r.json?.transaction?.status === "success" || /ended/.test(errMsg(r))), "in-flight purchases either finished or were refused (never charged)", results.map((r) => r.json?.transaction?.status ?? errMsg(r)));
tm = await totalsMatch(eventId);
ok(tm.same, "final running total equals the orders", tm);
const ledger = await sql("select count(*)::int n from app.wallet_ledger l join app.users u on u.id = l.user_id where u.email like $1", [`rush.${run}.%`]);
ok(ledger[0].n === 0, "no wallet was touched by any free purchase", ledger);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
