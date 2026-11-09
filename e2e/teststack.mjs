// Local test stack: embedded Postgres (5433), fake Peyflex (4590), fake Moneta (4592) and a
// helper (4591: POST /sql, POST /moneta/credit, GET /calls, POST /reset-calls, POST /moneta/mode).
// No real provider is ever called.
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const dir = mkdtempSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "pgdata-"));
const db = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "password", port: 5433, persistent: false, initdbFlags: ["--encoding=UTF8", "--locale=C"] });
await db.initialise();
await db.start();
await db.createDatabase("wymlink");
const pool = new pg.Pool({ connectionString: "postgres://postgres:password@localhost:5433/wymlink" });
console.log("postgres ready on 5433");

const calls = [];
const body = (req) => new Promise((r) => { let s = ""; req.on("data", (d) => (s += d)); req.on("end", () => { try { r(s ? JSON.parse(s) : {}); } catch { r({ raw: s }); } }); });
const send = (res, status, json) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(json)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Fake Peyflex ----------
const tvPlans = {
  gotv: [["gotv-easy", "4000", "Gotv Easy"], ["gotv-starter", "6000", "Gotv Starter"], ["gotv-select", "11000", "Gotv Select"]],
  dstv: [["dstv-movie-bundle-add-on", "3500", "DStv Movie Bundle Addon E36"], ["dstv-starter36", "6000", "Dstv Starter E36"], ["dstv-select36", "11000", "Dstv Select E36"]],
  startimes: [["nova", "1900", "Nova"]],
};
const dataPlans = [
  { plan_code: "D500", amount: 500, label: "1GB = N500" },
  { plan_code: "D2500", amount: 2500, label: "5GB = N2500" },
  { plan_code: "D4000", amount: 4000, label: "10GB = N4000" },
  { plan_code: "D9000", amount: 9000, label: "25GB = N9000" },
];
let peyBalance = 1_000_000;
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const b = req.method === "POST" ? await body(req) : {};
  const p = u.pathname;
  if (req.method === "POST") calls.push({ at: Date.now(), to: "peyflex", path: p, body: b });
  if (p === "/api/cable/providers/") return send(res, 200, { status: "SUCCESS", providers: [{ identifier: "startimes", name: "Startimes" }, { identifier: "gotv", name: "GOTV" }, { identifier: "dstv", name: "DSTV" }] });
  const m = /^\/api\/cable\/plans\/([a-z]+)\/$/.exec(p);
  if (m) return send(res, 200, { status: "SUCCESS", identifier: m[1], plans: (tvPlans[m[1]] ?? []).map(([plan_code, amount, display]) => ({ plan_code, amount, display })) });
  if (p === "/api/data/plans/") return send(res, 200, { plans: dataPlans });
  if (p === "/api/data/networks/" || p === "/api/airtime/networks/") return send(res, 200, { networks: [{ identifier: "mtn", name: "MTN" }] });
  if (p === "/api/electricity/plans/") return send(res, 200, { plans: [{ plan_code: "abuja-electric", plan_name: "AEDC", min_amount: 1000, max_amount: 500000 }] });
  if (p === "/api/cable/verify/") return send(res, 200, { status: "SUCCESS", customer_name: "TEST VIEWER" });
  if (p.startsWith("/api/electricity/verify/")) return send(res, 200, { status: "SUCCESS", customer_name: "TEST METER" });
  if (["/api/airtime/topup/", "/api/data/purchase/", "/api/cable/subscribe/", "/api/electricity/subscribe/"].includes(p)) {
    const who = String(b.mobile_number ?? b.iuc ?? b.meter ?? "");
    if (who.endsWith("0099") || who.endsWith("999999")) return send(res, 200, { status: "FAILED", message: "Declined by network" });
    if (who.endsWith("0098")) await sleep(1500);
    const amount = Number(b.amount ?? dataPlans.find((d) => d.plan_code === b.plan_code)?.amount ?? 0);
    peyBalance -= amount;
    return send(res, 200, { status: "SUCCESS", reference: `PFX${Date.now()}${Math.floor(Math.random() * 1e4)}`, message: "Delivered", balance: String(peyBalance), token: p.includes("electricity") ? "1234-5678-9012-3456-7890" : undefined });
  }
  send(res, 404, { error: "not faked: " + p });
}).listen(4590, () => console.log("fake peyflex on 4590"));

// ---------- Fake Moneta ----------
const accounts = new Map(); // accountNumber -> {ref, name, balance, history: []}
let monetaMode = { rejectDigitsInName: false, failCreate: false, createDelayMs: 0 };
const byRef = (ref) => [...accounts.values()].find((a) => a.ref === ref);
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const b = req.method === "POST" ? await body(req) : {};
  const p = u.pathname;
  calls.push({ at: Date.now(), to: "moneta", method: req.method, path: p, body: b });
  if (p === "/partner/auth/access-token") return send(res, 200, { status: true, data: { access_token: "fake-token", expires_at: new Date(Date.now() + 8 * 3600_000).toISOString() } });
  if (p === "/partner/virtual-accounts" && req.method === "POST") {
    if (monetaMode.createDelayMs) await sleep(monetaMode.createDelayMs);
    if (monetaMode.failCreate) return send(res, 422, { status: false, message: "Validation error" });
    if (monetaMode.rejectDigitsInName && /\d/.test(String(b.account_name))) return send(res, 422, { status: false, message: "Validation error", errors: { account_name: ["letters only"] } });
    if (!/^\d{11}$/.test(String(b.bvn))) return send(res, 422, { status: false, message: "Validation error", errors: { bvn: ["must be 11 digits"] } });
    const num = "9" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
    const ref = "VA" + Math.random().toString(36).slice(2, 14).toUpperCase();
    const acct = { ref, number: num, name: `MONETA TECH(WYMNET-${b.account_name})`, balance: 0, history: [], body: b };
    accounts.set(num, acct);
    return send(res, 200, { status: true, message: "Account created successfully", data: { virtual_account_reference: ref, account_number: num, account_name: acct.name, bank_name: "Providus Bank" } });
  }
  if (p === "/partner/virtual-accounts/account-balance") {
    const a = byRef(u.searchParams.get("virtual_account_reference"));
    return a ? send(res, 200, { status: true, data: { balance: a.balance.toFixed(2) } }) : send(res, 404, { status: false, message: "Not found" });
  }
  if (p === "/partner/virtual-accounts/transaction-histories") {
    const a = byRef(u.searchParams.get("virtual_account_reference"));
    return send(res, 200, { status: true, data: a ? a.history : [] });
  }
  if (p === "/partner/virtual-accounts/transfer") {
    const from = accounts.get(String(b.source_virtual_account));
    const to = accounts.get(String(b.destination_virtual_account));
    if (!from || !to) return send(res, 400, { status: false, message: "Account not found" });
    if (from.balance < Number(b.amount)) return send(res, 400, { status: false, message: "Insufficient funds" });
    from.balance -= Number(b.amount);
    to.balance += Number(b.amount);
    return send(res, 200, { status: true, message: "Transfer successful", data: { status: "success", reference: "TRF" + Date.now() } });
  }
  send(res, 404, { status: false, message: "not faked: " + p });
}).listen(4592, () => console.log("fake moneta on 4592"));

// ---------- Helper ----------
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const b = req.method === "POST" ? await body(req) : {};
  try {
    if (u.pathname === "/sql") return send(res, 200, (await pool.query(b.sql, b.params ?? [])).rows);
    if (u.pathname === "/calls") return send(res, 200, calls.filter((c) => !u.searchParams.get("since") || c.at >= Number(u.searchParams.get("since"))));
    if (u.pathname === "/reset-calls") { calls.length = 0; return send(res, 200, { ok: true }); }
    if (u.pathname === "/moneta/mode") { monetaMode = { ...monetaMode, ...b }; return send(res, 200, monetaMode); }
    if (u.pathname === "/moneta/accounts") return send(res, 200, [...accounts.values()].map(({ history, ...a }) => a));
    if (u.pathname === "/moneta/credit") {
      const a = accounts.get(String(b.accountNumber));
      if (!a) return send(res, 404, { error: "no such account" });
      a.balance += Number(b.amount);
      a.history.unshift({ reference: "MNT" + Date.now() + Math.floor(Math.random() * 1000), action_type: "credit", status: "success", amount_paid: String(b.amount), amount_settled: Number(b.amount), transaction_fee: 0, paid_at: new Date().toISOString().replace("T", " ").slice(0, 19), virtual_account_reference: a.ref, merchant_name: "TEST SENDER" });
      return send(res, 200, { ok: true, balance: a.balance });
    }
    send(res, 404, { error: "unknown" });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}).listen(4591, () => console.log("helper on 4591"));

const stop = async () => { await pool.end().catch(() => {}); await db.stop().catch(() => {}); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
