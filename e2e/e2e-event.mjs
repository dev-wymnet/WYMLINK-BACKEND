// End to end against the local stack (backend :4000, helper :4591, fakes): free event,
// account numbers at sign-up, customer IDs, business QR payments. No real provider is used.
const API = "http://localhost:4000/api/v1";
const H = "http://localhost:4591";
let pass = 0, fail = 0;
const ok = (cond, label, extra) => { if (cond) { pass++; console.log("  ok  ", label); } else { fail++; console.log("  FAIL", label, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ""); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = async (q, params) => (await fetch(`${H}/sql`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sql: q, params }) })).json();
const helper = async (path, body) => (await fetch(`${H}${path}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
async function call(method, path, token, body) {
  const r = await fetch(`${API}${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
const ref = (p = "t") => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const run = Date.now().toString().slice(-6);
const errCode = (r) => r.json?.code ?? r.json?.error?.code ?? r.json?.errorCode;
const errMsg = (r) => r.json?.message ?? r.json?.error?.message ?? JSON.stringify(r.json);

async function customer(tag, phoneTail) {
  const phone = `+23480${run.slice(-1)}${phoneTail}`;
  const r = await call("POST", "/auth/signup", null, { firstName: `Test${tag}`, lastName: "Customer", email: `e2e.${tag}.${run}@test.local`, phone, password: "Passw0rd!long" });
  if (r.status >= 300) throw new Error(`signup ${tag}: ${r.status} ${JSON.stringify(r.json)}`);
  const token = r.json.accessToken ?? r.json.tokens?.accessToken;
  await call("POST", "/auth/pin/transaction/set", token, { pin: "1357" });
  return { token, phone, id: r.json.user?.id };
}
const balance = async (c) => Number((await call("GET", "/wallets/me", c.token)).json?.balance ?? NaN);
const airtime = (c, amount, phone, promo = true) => call("POST", "/telecom/airtime/purchase", c.token, { internalReference: ref("air"), network: "mtn", amount, mobileNumber: phone, transactionPin: "1357", ...(promo ? { promo: true } : {}) });
const data = (c, planCode, phone, promo = true) => call("POST", "/telecom/data/purchase", c.token, { internalReference: ref("dat"), network: "mtn", planCode, mobileNumber: phone, transactionPin: "1357", ...(promo ? { promo: true } : {}) });
const cable = (c, identifier, plan, iuc, promo = true) => call("POST", "/bills/cable/subscribe", c.token, { internalReference: ref("tv"), identifier, plan, iuc, phone: c.phone, transactionPin: "1357", ...(promo ? { promo: true } : {}) });

await sql("update app.promo_events set active = false, ended_at = now() where active");
console.log("== Account numbers at sign-up, customer IDs");
await helper("/reset-calls", {});
const A = await customer("a", "1110001");
const meA = await call("GET", "/user/me", A.token);
const codeA = meA.json?.customerCode ?? meA.json?.user?.customerCode;
ok(/^WL\d{6}$/.test(String(codeA)), "customer ID is WL + 6 digits", meA.json);
await sleep(800);
let va = await call("GET", "/wallets/virtual-account", A.token);
for (let i = 0; i < 10 && !va.json?.account; i++) { await sleep(500); va = await call("GET", "/wallets/virtual-account", A.token); }
ok(/^\d{10}$/.test(String(va.json?.account?.accountNumber)), "account number opened right after sign-up, no BVN/NIN", va.json);
const created = (await helper("/calls")).filter((c) => c.to === "moneta" && c.path === "/partner/virtual-accounts");
ok(created.length === 1, "exactly one Moneta account created", created.length);
ok(created[0]?.body?.account_name === codeA, "Moneta account named with the customer ID", created[0]?.body);
ok(created[0]?.body?.bvn === "00000000000" && created[0]?.body?.nin === "0000000000", "placeholder BVN and NIN sent", created[0]?.body);
ok(String(va.json?.account?.accountName).includes(codeA) && String(va.json?.account?.accountName).endsWith("TESTA CUSTOMER)"), "account name shows the customer ID and their name", va.json?.account?.accountName);
const again = await call("POST", "/wallets/virtual-account", A.token, {});
ok(again.status < 300 && again.json?.account?.accountNumber === va.json?.account?.accountNumber, "old 'get account number' call works without BVN/NIN and returns the same account", again);
const dash = await call("GET", "/dashboard/home", A.token);
ok(dash.json?.user?.customerCode === codeA && dash.json?.wallet?.accountNumber === va.json?.account?.accountNumber, "dashboard shows customer ID and account number", dash.json?.user);
ok(dash.json?.wallet?.accountName === va.json?.account?.accountName, "dashboard shows the same account name", dash.json?.wallet);
const wme = await call("GET", "/wallets/me", A.token);
ok(wme.json?.reservedAccount?.accountName === va.json?.account?.accountName, "wallet shows the same account name", wme.json?.reservedAccount);

console.log("== Moneta down at sign-up: sign-up still works, account opens later");
await helper("/moneta/mode", { failCreate: true });
const Z = await customer("z", "1110026");
await sleep(600);
let vz = await call("GET", "/wallets/virtual-account", Z.token);
ok(Z.token && !vz.json?.account && vz.json?.setup === "opening", "sign-up succeeds while Moneta fails; account shows as 'opening'", vz.json);
await helper("/moneta/mode", { failCreate: false });
await sql("delete from app.provider_tokens where provider like 'va-open:%'"); // lease expiry (5 min) simulated
vz = await call("GET", "/wallets/virtual-account", Z.token);
for (let i = 0; i < 10 && !vz.json?.account; i++) { await sleep(500); vz = await call("GET", "/wallets/virtual-account", Z.token); }
ok(/^\d{10}$/.test(String(vz.json?.account?.accountNumber)), "account opens on a later visit once Moneta is back", vz.json);

console.log("== No event running");
const none = await call("GET", "/promo/current", A.token);
ok(none.status === 200 && none.json?.event === null, "no event: /promo/current says none", none.json);
const early = await airtime(A, 500, A.phone);
ok(early.status === 400 && errCode(early) === "PROMO_UNAVAILABLE", "free purchase refused (not charged) with no event", early.json);

console.log("== Admin starts the event");
const adminLogin = await call("POST", "/admin/auth/login", null, { email: "admin@test.local", password: "Admin-Pass-12345!" });
const admin = adminLogin.json?.accessToken ?? adminLogin.json?.data?.accessToken;
ok(Boolean(admin), "admin signed in", adminLogin.json);
const start = await call("POST", "/admin/promo", admin, { title: "Wymlink Launch Day", message: "Free data, airtime and TV today, on us!", dataMax: 8000, airtimeMax: 5000, tvPlans: ["gotv-easy", "dstv-starter36"], tvPerProvider: 1, budget: null });
ok(start.status === 201 && start.json?.event?.active, "event started", start.json);
const eventId = start.json?.event?.id;
const twice = await call("POST", "/admin/promo", admin, { title: "x", message: "y", dataMax: 1, airtimeMax: 1, tvPlans: [], tvPerProvider: 0, budget: null });
ok(twice.status === 400, "a second event can't start while one runs", twice.json);
const badPlan = await call("PATCH", `/admin/promo/${eventId}`, admin, { tvPlans: ["gotv-nonexistent"] });
ok(badPlan.status === 400, "unknown TV plan code refused", badPlan.json);
const cur = await call("GET", "/promo/current", A.token);
ok(cur.json?.event?.id === eventId && cur.json?.mine?.dataLeft === "8000.00" && cur.json?.mine?.airtimeLeft === "5000.00", "customer sees event and full allowances", cur.json);
ok((cur.json?.event?.tvPlans ?? []).some((p) => p.planCode === "gotv-easy" && p.name === "Gotv Easy" && p.amount === "4000.00"), "TV base plans come with names and prices", cur.json?.event?.tvPlans);

console.log("== Airtime allowance (₦5,000 per customer)");
await helper("/reset-calls", {});
const b0 = await balance(A);
const a1 = await airtime(A, 3000, A.phone);
ok(a1.status === 200 && a1.json?.transaction?.status === "success" && a1.json?.transaction?.promo === true, "₦3,000 free airtime delivered", a1.json);
const a2 = await airtime(A, 2000, A.phone);
ok(a2.json?.transaction?.status === "success", "₦2,000 more (total ₦5,000) delivered", a2.json);
const a3 = await airtime(A, 50, A.phone);
ok(a3.status === 400 && errCode(a3) === "PROMO_UNAVAILABLE" && /used your free airtime/.test(errMsg(a3)), "₦50 over the allowance refused", a3.json);
ok((await balance(A)) === b0, "wallet untouched by free airtime", { b0, now: await balance(A) });
const ledgerA = await sql("select count(*)::int n from app.wallet_ledger where user_id = $1", [A.id]);
ok(ledgerA[0]?.n === 0, "no ledger lines for free purchases", ledgerA);
const peyCalls = (await helper("/calls")).filter((c) => c.to === "peyflex" && c.path === "/api/airtime/topup/");
ok(peyCalls.length === 2, "Peyflex called only for the 2 allowed purchases", peyCalls.length);

console.log("== Data allowance (₦8,000 per customer)");
const d1 = await data(A, "D4000", A.phone);
const d2 = await data(A, "D4000", A.phone);
ok(d1.json?.transaction?.status === "success" && d2.json?.transaction?.status === "success", "2 x ₦4,000 data delivered (₦8,000)", [d1.json, d2.json]);
const d3 = await data(A, "D500", A.phone);
ok(d3.status === 400 && /used your free data/.test(errMsg(d3)), "₦500 more data refused", d3.json);
const mine = await call("GET", "/promo/current", A.token);
ok(mine.json?.mine?.dataLeft === "0.00" && mine.json?.mine?.airtimeLeft === "0.00", "allowance shows used up", mine.json?.mine);

console.log("== Per recipient (other accounts can't stack on one phone/smartcard)");
const B = await customer("b", "1110002");
const r1 = await data(B, "D500", A.phone);
ok(r1.status === 400 && /This number has already received its free data/.test(errMsg(r1)), "B can't send free data to A's number (already at ₦8,000)", r1.json);
const r2 = await data(B, "D9000", B.phone);
ok(r2.status === 400 && /₦8,000 of free data left/.test(errMsg(r2)), "a single ₦9,000 plan is over the allowance", r2.json);
const r3 = await data(B, "D2500", B.phone);
ok(r3.json?.transaction?.status === "success", "B's own free data works", r3.json);

console.log("== TV: base plans only, one per provider, one per smartcard");
const t1 = await cable(B, "gotv", "gotv-starter", "7000000001");
ok(t1.status === 400 && /Only the base plan/.test(errMsg(t1)), "GOtv Starter (not the base plan) refused", t1.json);
const t2 = await cable(B, "gotv", "gotv-easy", "7000000001");
ok(t2.json?.transaction?.status === "success", "GOtv Easy (base) delivered free", t2.json);
const t3 = await cable(B, "gotv", "gotv-easy", "7000000002");
ok(t3.status === 400 && /already used your free GOTV/.test(errMsg(t3)), "second free GOtv for the same customer refused", t3.json);
const t4 = await cable(B, "dstv", "dstv-starter36", "8000000001");
ok(t4.json?.transaction?.status === "success", "DStv Starter (base) delivered free", t4.json);
const t5 = await cable(A, "gotv", "gotv-easy", "7000000001");
ok(t5.status === 400 && /smartcard has already/.test(errMsg(t5)), "another customer can't reuse the same smartcard", t5.json);
const t6 = await cable(B, "dstv", "dstv-movie-bundle-add-on", "8000000002");
ok(t6.status === 400, "cheaper DStv add-on is not free", t6.json);
const el = await call("POST", "/bills/electricity/subscribe", B.token, { internalReference: ref("el"), meter: "12345678901", plan: "abuja-electric", amount: 1000, type: "prepaid", phone: B.phone, transactionPin: "1357", promo: true });
ok(el.status === 400 && /Electricity isn't part/.test(errMsg(el)), "electricity is not free", el.json);

console.log("== Provider failure doesn't use the allowance or touch the wallet");
const E = await customer("e", "1110005");
const fphone = `+234803${run.slice(0, 3)}0099`;
const f1 = await airtime(E, 5000, fphone);
ok(f1.json?.transaction?.status === "failed" && f1.json?.transaction?.refunded === false, "declined free airtime shows failed (nothing to refund)", f1.json);
const f2 = await airtime(E, 5000, E.phone);
ok(f2.json?.transaction?.status === "success", "full ₦5,000 still available after the failure", f2.json);
const ledgerE = await sql("select count(*)::int n from app.wallet_ledger where user_id = $1", [E.id]);
ok(ledgerE[0]?.n === 0, "no refund credit for a free order", ledgerE);

console.log("== Concurrency: 5 simultaneous ₦4,000 free data purchases, allowance ₦8,000");
const C = await customer("c", "1110003");
const phones = [1, 2, 3, 4, 5].map((i) => `+234803${run.slice(0, 2)}${i}0098`);
const results = await Promise.all(phones.map((p) => data(C, "D4000", p)));
const won = results.filter((r) => r.json?.transaction?.status === "success").length;
const refused = results.filter((r) => r.status === 400 && errCode(r) === "PROMO_UNAVAILABLE").length;
ok(won === 2 && refused === 3, "exactly 2 delivered, 3 refused", results.map((r) => r.json?.transaction?.status ?? errMsg(r)));
const sumC = await sql("select coalesce(sum(amount),0)::text s from app.vtu_orders where user_id=$1 and promo_event_id is not null and status='success'", [C.id]);
ok(sumC[0]?.s === "8000.00", "C's delivered free data totals exactly ₦8,000", sumC);

console.log("== Budget ceiling");
const ov = await call("GET", "/admin/promo", admin);
const committed = Number(ov.json?.current?.stats?.committed);
const setB = await call("PATCH", `/admin/promo/${eventId}`, admin, { budget: committed + 600 });
ok(setB.status === 200 && Number(setB.json?.event?.budget) === committed + 600, "budget set to spent + ₦600", setB.json);
const D = await customer("d", "1110004");
const bud1 = await airtime(D, 500, D.phone);
ok(bud1.json?.transaction?.status === "success", "₦500 within the budget delivered", bud1.json);
const bud2 = await airtime(D, 200, D.phone);
ok(bud2.status === 400 && /all been given out/.test(errMsg(bud2)), "₦200 over the budget refused", bud2.json);
await call("PATCH", `/admin/promo/${eventId}`, admin, { budget: null });

console.log("== Collections never count free purchases");
const owed = await call("GET", "/admin/collections/owed", admin);
const rowsOwed = (owed.json?.customers ?? []).filter((c) => [A.id, B.id, C.id, D.id, E.id].includes(c.userId));
ok(owed.status === 200 && rowsOwed.every((c) => c.spent === "0.00" && c.owed === "0.00"), "free orders owe nothing", rowsOwed.map((c) => [c.spent, c.owed]));

console.log("== Admin overview");
const ov2 = await call("GET", "/admin/promo", admin);
const st = ov2.json?.current?.stats;
const deliveredTotal = (st?.byProduct ?? []).reduce((a, p) => a + Number(p.deliveredAmount), 0);
const dbTotal = await sql("select coalesce(sum(amount),0)::numeric::float8 s from app.vtu_orders where promo_event_id=$1 and status='success'", [eventId]);
ok(Math.abs(deliveredTotal - dbTotal[0].s) < 0.01 && st?.customers >= 5, "stats match the orders", { st, db: dbTotal });
ok(st?.peyflexBalance !== null, "last Peyflex balance shown", st?.peyflexBalance);
const evOrders = await call("GET", `/admin/promo/${eventId}/orders?limit=50`, admin);
ok(evOrders.json?.orders?.length >= 10 && evOrders.json.orders.every((o) => /^WL\d{6}$/.test(o.customerCode)), "event orders list with customer IDs", evOrders.json?.orders?.length);

console.log("== Kill switch");
const end = await call("POST", `/admin/promo/${eventId}/end`, admin, {});
ok(end.status === 200 && end.json?.event?.active === false && end.json?.event?.endedAt, "event ended", end.json);
const after = await call("GET", "/promo/current", D.token);
ok(after.json?.event === null, "customers see no event", after.json);
const k1 = await airtime(D, 100, D.phone);
ok(k1.status === 400 && /ended/.test(errMsg(k1)), "free purchase refused after the kill switch (not charged)", k1.json);
const k2 = await airtime(D, 100, D.phone, false);
ok(k2.status >= 400 && errCode(k2) !== "PROMO_UNAVAILABLE", "normal paid purchase works as before (refused for no balance)", k2.json);
const end2 = await call("POST", `/admin/promo/${eventId}/end`, admin, {});
ok(end2.status === 200, "ending twice is harmless", end2.json);
const restart = await call("POST", "/admin/promo", admin, { title: "Day 2", message: "Again", dataMax: 1000, airtimeMax: 1000, tvPlans: ["gotv-easy"], tvPerProvider: 1, budget: 5000 });
ok(restart.status === 201, "a new event can start after ending", restart.json);
const d2Cur = await call("GET", "/promo/current", A.token);
ok(d2Cur.json?.mine?.airtimeLeft === "1000.00", "a new event has fresh allowances", d2Cur.json?.mine);
await call("POST", `/admin/promo/${restart.json?.event?.id}/end`, admin, {});
const custEnd = await call("POST", `/admin/promo/${eventId}/end`, A.token, {});
ok(custEnd.status === 401 || custEnd.status === 403, "customers can't use the kill switch", custEnd.status);
const custStart = await call("POST", "/admin/promo", A.token, { title: "x", message: "y", dataMax: 1, airtimeMax: 1, tvPlans: [], tvPerProvider: 0, budget: null });
ok(custStart.status === 401 || custStart.status === 403, "customers can't start events", custStart.status);

console.log("== Business QR payments");
await helper("/reset-calls", {});
const biz = await call("POST", "/admin/businesses", admin, { name: "Wymnet Cafe & Lounge" });
ok(biz.status === 201 && /^[A-Z2-9]{6}$/.test(biz.json?.business?.code) && /^\d{10}$/.test(String(biz.json?.business?.account?.accountNumber)), "business created with a code and account number", biz.json);
const bcode = biz.json?.business?.code;
const bcreate = (await helper("/calls")).find((c) => c.to === "moneta" && c.path === "/partner/virtual-accounts");
ok(bcreate?.body?.account_name === "WymnetCa", "business account named after the business", bcreate?.body);
const pub = await call("GET", `/businesses/${bcode.toLowerCase()}`, null);
ok(pub.status === 200 && pub.json?.business?.name === "Wymnet Cafe & Lounge" && pub.json?.business?.acceptsPayments === true, "QR lookup works without sign-in", pub.json);
const badCode = await call("GET", "/businesses/ZZZZZZ", null);
ok(badCode.status === 404, "unknown code says not a Wymlink business", badCode.json);
// Fund A: money lands at (fake) Moneta, then Moneta's notification credits the wallet.
await helper("/moneta/credit", { accountNumber: va.json.account.accountNumber, amount: 2000 });
await call("POST", "/webhooks/moneta", null, { notification_type: "virtual_account_static", payment: { reference: ref("pay") }, virtualAccount: { account_number: va.json.account.accountNumber } });
let balA = 0;
for (let i = 0; i < 20 && balA < 2000; i++) { await sleep(300); balA = await balance(A); }
ok(balA === 2000, "A funded with ₦2,000", balA);
const pay = await call("POST", `/businesses/${bcode}/pay`, A.token, { amount: 500, transactionPin: "1357", reference: ref("qr") });
ok(pay.status === 200 && pay.json?.transfer?.status === "success" && pay.json?.business?.name === "Wymnet Cafe & Lounge", "A paid the business ₦500", pay.json);
ok((await balance(A)) === 1500, "A's balance ₦1,500", await balance(A));
const list = await call("GET", "/admin/businesses", admin);
const mineBiz = list.json?.businesses?.find((b) => b.code === bcode);
ok(mineBiz?.balance === "500.00" && mineBiz?.payments?.count === 1, "business shows ₦500 received, 1 payment", mineBiz);
const accts = await helper("/moneta/accounts");
ok(accts.find((a) => a.number === mineBiz?.account?.accountNumber)?.balance === 500, "money moved at Moneta into the business account", accts);
const pays = await call("GET", `/admin/businesses/${mineBiz?.id}/payments`, admin);
ok(pays.json?.payments?.[0]?.payer === "Testa Customer" && pays.json.payments[0].payerCode === codeA, "payments list shows the payer and customer ID", pays.json);
const wrongPin = await call("POST", `/businesses/${bcode}/pay`, A.token, { amount: 100, transactionPin: "0000", reference: ref("qr") });
ok(wrongPin.status === 403, "wrong PIN refused", wrongPin.json);
const tooMuch = await call("POST", `/businesses/${bcode}/pay`, A.token, { amount: 5000, transactionPin: "1357", reference: ref("qr") });
ok(tooMuch.status >= 400 && (await balance(A)) === 1500, "paying more than the balance is refused, nothing taken", tooMuch.json);
await call("PATCH", `/admin/businesses/${mineBiz?.id}`, admin, { active: false });
const off = await call("POST", `/businesses/${bcode}/pay`, A.token, { amount: 100, transactionPin: "1357", reference: ref("qr") });
ok(off.status === 400 && /isn't taking payments/.test(errMsg(off)), "disabled business refuses payments", off.json);
await call("PATCH", `/admin/businesses/${mineBiz?.id}`, admin, { active: true });
const bizLogin = await call("POST", "/auth/login", null, { email: `business.${bcode.toLowerCase()}@wymnet.org`, password: "anything-at-all" });
ok(bizLogin.status === 401, "a business account can't sign in", bizLogin.status);
const custBiz = await call("POST", "/admin/businesses", A.token, { name: "Hack" });
ok(custBiz.status === 401 || custBiz.status === 403, "customers can't create businesses", custBiz.status);
const dup = await call("POST", `/businesses/${bcode}/pay`, A.token, { amount: 100, transactionPin: "1357", reference: "same-ref-123456" });
const dup2 = await call("POST", `/businesses/${bcode}/pay`, A.token, { amount: 100, transactionPin: "1357", reference: "same-ref-123456" });
ok(dup.json?.transfer?.id && dup.json?.transfer?.id === dup2.json?.transfer?.id && (await balance(A)) === 1400, "a repeated payment reference is charged once", [dup.json?.transfer?.id, dup2.json?.transfer?.id, await balance(A)]);

console.log("== Conference Wi-Fi: one busy customer doesn't lock out the room");
const burst = [];
for (let i = 0; i < 130; i++) burst.push(call("GET", "/promo/current", B.token));
const codes = (await Promise.all(burst)).map((r) => r.status);
ok(codes.filter((c) => c === 429).length > 0 && codes.filter((c) => c === 200).length >= 90, "a single session is limited after ~100 a minute", { ok: codes.filter((c) => c === 200).length, limited: codes.filter((c) => c === 429).length });
const other = await call("GET", "/promo/current", C.token);
ok(other.status === 200, "another customer on the same IP is not affected", other.status);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
