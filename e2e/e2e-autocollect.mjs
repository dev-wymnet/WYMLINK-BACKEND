// Automatic daily collections and the Peyflex low-balance warning, against the local stack.
// Start the backend with the settings below (they make "today's run" due at once and check
// every 5 seconds), on a fresh teststack.mjs:
//
//   DOTENV_CONFIG_PATH=e2e/test.env MAIL_RELAY_URL=http://localhost:4591/mail MAIL_RELAY_SECRET=test-relay \
//   AUTO_COLLECT_HOUR=0 AUTO_COLLECT_CHECK_SECONDS=5 node --import tsx src/index.ts
//
// then `node e2e-autocollect.mjs a`. For part b, restart the backend with the same settings
// plus AUTO_COLLECT_DAILY_MAX=1500 (the daily limit), then `node e2e-autocollect.mjs b`.
import { readFileSync, writeFileSync } from "node:fs";

const API = "http://localhost:4000/api/v1";
const H = "http://localhost:4591";
const STATE = new URL("./.autocollect-state.json", import.meta.url);
const part = process.argv[2] ?? "a";
let pass = 0, fail = 0;
const ok = (cond, label, extra) => { if (cond) { pass++; console.log("  ok  ", label); } else { fail++; console.log("  FAIL", label, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ""); } };
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
const mails = async () => helper("/mail");
const mailsLike = async (re) => (await mails()).filter((m) => re.test(m.subject));
const waitFor = async (fn, ms = 30_000, step = 500) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(step); } return v; };

async function customer(tag, phoneTail) {
  const phone = `+23481${run.slice(-1)}${phoneTail}`;
  const r = await call("POST", "/auth/signup", null, { firstName: `Auto${tag}`, lastName: "Customer", email: `auto.${tag}.${run}@test.local`, phone, password: "Passw0rd!long" });
  if (r.status >= 300) throw new Error(`signup ${tag}: ${r.status} ${JSON.stringify(r.json)}`);
  const token = r.json.accessToken ?? r.json.tokens?.accessToken;
  await call("POST", "/auth/pin/transaction/set", token, { pin: "1357" });
  let va = await call("GET", "/wallets/virtual-account", token);
  for (let i = 0; i < 20 && !va.json?.account; i++) { await sleep(300); va = await call("GET", "/wallets/virtual-account", token); }
  return { tag, token, phone, id: r.json.user?.id, account: va.json?.account?.accountNumber };
}
const balance = async (c) => Number((await call("GET", "/wallets/me", c.token)).json?.balance ?? NaN);
async function fund(c, amount) {
  const before = await balance(c);
  await helper("/moneta/credit", { accountNumber: c.account, amount });
  await call("POST", "/webhooks/moneta", null, { notification_type: "virtual_account_static", payment: { reference: ref("pay") }, virtualAccount: { account_number: c.account } });
  return waitFor(async () => (await balance(c)) >= before + amount, 15_000, 300);
}
const airtime = (c, amount) => call("POST", "/telecom/airtime/purchase", c.token, { internalReference: ref("air"), network: "mtn", amount, mobileNumber: c.phone, transactionPin: "1357" });
const vaBalance = async (c) => (await helper("/moneta/accounts")).find((a) => a.number === c.account)?.balance;
const collectionsOf = async (c) => sql("select status, sent::text, fee::text, gross::text, created_by, last_error, narration from app.collections where user_id = $1 order by created_at", [c.id]);
const auditCount = async (action) => (await sql("select count(*)::int n from app.audit_log where action = $1", [action]))[0]?.n;

const login = await call("POST", "/admin/auth/login", null, { email: "admin@test.local", password: "Admin-Pass-12345!" });
const admin = login.json?.accessToken ?? login.json?.data?.accessToken;
ok(Boolean(admin), "admin signed in", login.json);

if (part === "a") {
  console.log("== Before any collection account");
  const st0 = await call("GET", "/admin/collections/auto", admin);
  ok(st0.status === 200 && st0.json?.auto?.enabled === true && st0.json?.auto?.accountSet === false && st0.json?.auto?.nextRun === null && st0.json?.auto?.minOwed === "1000.00", "status: on, no account, no next run", st0.json);

  const P = await customer("p", "2220001"); // owes ₦1,500: collected
  const Q = await customer("q", "2220002"); // owes ₦500: under the ₦1,000 minimum, left for later
  const R = await customer("r", "2220003"); // owes ₦1,200: the bank declines the payout
  const S = await customer("s", "2220004"); // owes ₦2,000: Moneta doesn't answer (unknown)
  const T = await customer("t", "2220005"); // owes ₦1,000 exactly: collected
  ok([P, Q, R, S, T].every((c) => /^\d{10}$/.test(String(c.account))), "5 customers with account numbers");
  for (const [c, dep] of [[P, 2000], [Q, 1000], [R, 1200], [S, 2000], [T, 1000]]) ok(await fund(c, dep), `${c.tag.toUpperCase()} funded ₦${dep}`);
  for (const [c, amt] of [[P, 1500], [Q, 500], [R, 1200], [S, 2000], [T, 1000]]) {
    const r = await airtime(c, amt);
    ok(r.json?.transaction?.status === "success", `${c.tag.toUpperCase()} bought ₦${amt} airtime`, r.json);
  }

  const remind = await waitFor(async () => (await mailsLike(/set a collection account/)).length > 0, 20_000);
  ok(remind, "no account: the team is emailed to set one");
  await sleep(12_000);
  const reminders = await mailsLike(/set a collection account/);
  ok(reminders.length === 1, "the reminder is sent once a day, not every check", reminders.length);
  ok(reminders[0]?.to === "admin@test.local" && reminders[0]?.auth === "Bearer test-relay", "sent to the super admin through the mail relay", reminders[0]);
  ok((await sql("select count(*)::int n from app.collections"))[0].n === 0, "nothing collected without an account");

  console.log("== Collection account set");
  await helper("/moneta/mode", { failPayoutFor: [R.account], unknownPayoutFor: [S.account] });
  const bad = await call("POST", "/admin/collections/account", admin, { bankCode: "101", accountNumber: "1234560000" });
  ok(bad.status === 400, "an account the bank can't find is refused", bad.json);
  const set = await call("POST", "/admin/collections/account", admin, { bankCode: "101", accountNumber: "0123456789" });
  ok(set.status === 200 && set.json?.account?.accountName === "WYMNET TECHNOLOGIES LTD", "collection account set (name from the bank)", set.json);
  const changed = await waitFor(async () => (await mailsLike(/collection account was changed/)).at(-1), 10_000);
  ok(changed && /WYMNET TECHNOLOGIES LTD/.test(changed.text) && /0123456789/.test(changed.text) && /6 hours/.test(changed.text), "the change is emailed to the team", changed);
  const st1 = await call("GET", "/admin/collections/auto", admin);
  const settle = Date.parse(st1.json?.auto?.nextRun) - Date.now();
  ok(st1.json?.auto?.accountSet === true && settle > 5.9 * 3600_000 && settle < 6.1 * 3600_000, "next run: 6 hours after the account was set", st1.json?.auto);
  await sleep(12_000);
  ok((await sql("select count(*)::int n from app.collections"))[0].n === 0, "nothing collected in the first 6 hours");

  console.log("== The daily run");
  await sql("update app.collection_accounts set created_at = now() - interval '7 hours' where active");
  const done = await waitFor(async () => (await auditCount("AUTO_COLLECTION_DONE")) > 0, 60_000);
  ok(done, "the automatic run happened");
  const [p1] = await collectionsOf(P);
  ok(p1?.status === "success" && p1.sent === "1470.00" && p1.fee === "30.00" && p1.created_by === null, "P: ₦1,470 sent (₦1,500 less Moneta's ₦30), by the system", p1);
  const [t1] = await collectionsOf(T);
  ok(t1?.status === "success" && t1.sent === "970.00", "T: ₦970 sent (owed exactly the minimum)", t1);
  ok((await collectionsOf(Q)).length === 0, "Q: owes under ₦1,000, left for later");
  const [r1] = await collectionsOf(R);
  ok(r1?.status === "failed" && /declined/i.test(r1.last_error ?? ""), "R: payout declined, recorded as failed", r1);
  const [s1] = await collectionsOf(S);
  ok(s1?.status === "unknown", "S: no answer from Moneta, waiting", s1);
  ok((await vaBalance(P)) === 500 && (await balance(P)) === 500, "P's Moneta account now equals P's wallet (₦500)", [await vaBalance(P), await balance(P)]);
  ok((await vaBalance(R)) === 1200, "R's Moneta account untouched", await vaBalance(R));
  const pos = (await helper("/moneta/payouts")).filter((x) => x.status === "success");
  ok(pos.length === 2 && pos.every((x) => x.to === "0123456789"), "2 payouts, both to the collection account", pos);
  const sys = await sql("select count(*)::int n from app.audit_log where action = 'COLLECTION_RUN' and actor_role = 'system' and actor_user_id is null");
  ok(sys[0].n === 4, "each attempt is in the audit log as the system", sys);

  const summary = await waitFor(async () => (await mailsLike(/automatic collection/)).at(-1), 15_000);
  ok(summary?.subject === "Wymlink automatic collection: ₦2,440.00 collected", "summary email: ₦2,440 collected", summary?.subject);
  ok(/from 2 customers/.test(summary?.text) && /Moneta's fees: ₦60\.00/.test(summary?.text), "summary: 2 customers, ₦60 fees", summary?.text);
  ok(/Waiting for Moneta to confirm: ₦1,970\.00 from 1 customer/.test(summary?.text), "summary: S waiting", summary?.text);
  ok(/Failed, nothing moved: 1 customer/.test(summary?.text) && /Autor Customer: Payout declined/i.test(summary?.text), "summary: R failed, with the reason", summary?.text);
  ok(/Left for later: ₦500\.00 from 1 customer/.test(summary?.text), "summary: Q's ₦500 left for later", summary?.text);
  ok(/WYMNET TECHNOLOGIES LTD, Test Bank 0123456789/.test(summary?.text), "summary names the account it paid", summary?.text);

  console.log("== Once a day");
  await sleep(15_000);
  ok((await auditCount("AUTO_COLLECTION_RUN")) === 1 && (await sql("select count(*)::int n from app.collections"))[0].n === 4, "no second run the same day");
  ok((await mailsLike(/automatic collection/)).length === 1, "one summary email");
  const st2 = await call("GET", "/admin/collections/auto", admin);
  const next = Date.parse(st2.json?.auto?.nextRun) - Date.now();
  ok(st2.json?.auto?.lastRun?.summary?.collected?.sent === "2440.00" && next > 0 && next <= 24 * 3600_000, "status shows the last run and tomorrow's", st2.json?.auto);
  const owed = await call("GET", "/admin/collections/owed", admin);
  const owedOf = (c) => owed.json?.customers?.find((x) => x.userId === c.id);
  ok(owedOf(P)?.owed === "0.00" && owedOf(T)?.owed === "0.00" && owedOf(R)?.owed === "1200.00" && owedOf(S)?.owed === "0.00" && owedOf(S)?.inFlight === "2000.00", "Collections page: P and T settled, R still owes, S in flight", [owedOf(P), owedOf(R), owedOf(S), owedOf(T)]);

  writeFileSync(STATE, JSON.stringify({ P, Q, R, S, T, sNarration: s1?.narration }));
} else {
  const { Q, R, S, sNarration } = JSON.parse(readFileSync(STATE, "utf8"));
  console.log("== Next day: S confirmed, R retried, the daily limit (₦1,500)");
  const st = await call("GET", "/admin/collections/auto", admin);
  ok(st.json?.auto?.dailyMax === "1500.00", "backend restarted with a ₦1,500 daily limit", st.json?.auto);
  await helper("/moneta/mode", { failPayoutFor: [], unknownPayoutFor: [] });
  await helper("/moneta/payout-status", { tag: sNarration.split(" ")[0], status: "success" });
  ok((await airtime(Q, 500)).json?.transaction?.status === "success", "Q buys ₦500 more (now owes ₦1,000)");
  const before = (await mails()).length;
  // Yesterday: move the day's run and S's collection back (the audit log is append-only).
  await sql("alter table app.audit_log disable trigger audit_log_append_only");
  await sql("update app.audit_log set created_at = created_at - interval '1 day' where action like 'AUTO_COLLECTION%'");
  await sql("alter table app.audit_log enable trigger audit_log_append_only");
  await sql("update app.collections set created_at = created_at - interval '1 day' where status = 'unknown'");
  const done = await waitFor(async () => (await auditCount("AUTO_COLLECTION_DONE")) > 1, 60_000);
  ok(done, "the next day's run happened");
  const s = await sql("select status from app.collections where user_id = $1", [S.id]);
  ok(s.length === 1 && s[0].status === "success", "S's waiting collection confirmed from Moneta's history", s);
  const r = await sql("select status, sent::text from app.collections where user_id = $1 order by created_at", [R.id]);
  ok(r.length === 2 && r[1].status === "success" && r[1].sent === "1170.00", "R collected on the retry (₦1,170)", r);
  ok((await sql("select count(*)::int n from app.collections where user_id = $1", [Q.id]))[0].n === 0, "Q not collected: the daily limit was reached");
  const summary = await waitFor(async () => (await mails()).slice(before).find((m) => /automatic collection/.test(m.subject)), 15_000);
  ok(/Stopped at the daily limit of ₦1,500\.00/.test(summary?.text ?? ""), "summary says it stopped at the daily limit", summary?.text);

  console.log("== Peyflex low balance");
  const U = await customer("u", "2220006");
  ok(await fund(U, 5000), "U funded ₦5,000");
  await helper("/peyflex/balance", { balance: 21000 });
  ok((await airtime(U, 1500)).json?.transaction?.status === "success", "U buys ₦1,500 (Peyflex now ₦19,500)");
  const low = await waitFor(async () => (await mailsLike(/Peyflex balance is low/)).at(-1), 10_000);
  ok(low?.subject === "Wymlink: the Peyflex balance is low (₦19,500.00)", "low-balance email", low?.subject);
  ok((await airtime(U, 500)).json?.transaction?.status === "success", "U buys ₦500 more");
  await sleep(2000);
  ok((await mailsLike(/Peyflex balance is low/)).length === 1, "no second low-balance email within 6 hours");
  await helper("/peyflex/balance", { balance: 100 });
  const refused = await airtime(U, 500);
  ok(refused.json?.transaction?.status === "failed" && refused.json?.transaction?.refunded === true, "purchase refused once Peyflex runs out (refunded)", refused.json);
  const empty = await waitFor(async () => (await mailsLike(/has run out/)).at(-1), 10_000);
  ok(Boolean(empty), "'ran out' email goes out even after the low-balance one", empty?.subject);
  await airtime(U, 300);
  await sleep(2000);
  ok((await mailsLike(/has run out/)).length === 1, "only one 'ran out' email");
  await helper("/peyflex/balance", { balance: 1_000_000 });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
