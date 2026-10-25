// Schema integrity test: applies db/migrations/0001_wymlink_core.sql to an in-memory
// Postgres (PGlite) and tries to break every money rule.
// Run: npm i -D @electric-sql/pglite@0.2.17 && node db/tests/schema_test.mjs db/migrations/0001_wymlink_core.sql
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";

const sql = readFileSync(process.argv[2], "utf8");
const db = new PGlite({ extensions: { citext } });
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };
const expectError = async (name, q, code) => {
  try { await db.exec(q); ok(name, false, "no error raised"); }
  catch (e) { ok(name, !code || e.code === code || String(e.message).includes(code), `${e.code ?? ""} ${String(e.message).slice(0, 80)}`); }
};
const one = async (q, p) => (await db.query(q, p)).rows[0];

await db.exec(sql);
const v = await one("select version()");
console.log("Migration applied on", v.version.split(",")[0], "\n");

// Users & wallets
const u1 = (await one(`insert into app.users (first_name,last_name,email,phone,password_hash) values ('Ada','Obi','Ada@Example.com','+2348031234567','x') returning id`)).id;
const u2 = (await one(`insert into app.users (first_name,last_name,email,password_hash) values ('Bola','Ade','bola@example.com','x') returning id`)).id;
const w1 = (await one(`insert into app.wallets (user_id) values ($1) returning id`, [u1])).id;
const w2 = (await one(`insert into app.wallets (user_id) values ($1) returning id`, [u2])).id;

await expectError("email is case-insensitive unique", `insert into app.users (first_name,last_name,email,password_hash) values ('X','Y','ada@example.com','x')`, "23505");
await expectError("phone must be E.164", `insert into app.users (first_name,last_name,phone,password_hash) values ('X','Y','08031234567','x')`, "23514");
await expectError("user needs email or phone", `insert into app.users (first_name,last_name,password_hash) values ('X','Y','x')`, "23514");
await expectError("unknown role rejected", `insert into app.users (first_name,last_name,email,password_hash,role) values ('X','Y','r@x.com','x','admin')`, "23514");

// Posting money
const c1 = await one(`select * from app.post_entry($1,'credit',1000,'deposit','dep-1','Bank deposit')`, [w1]);
ok("credit 1000 → balance_after 1000", Number(c1.balance_after) === 1000);
const d1 = await one(`select * from app.post_entry($1,'debit',300,'purchase','air-1','Airtime','vtu_order',gen_random_uuid())`, [w1]);
ok("debit 300 → balance_after 700", Number(d1.balance_after) === 700 && Number(d1.balance_before) === 1000);
const bal = await one(`select available_balance from app.wallets where id=$1`, [w1]);
ok("wallet row agrees (700)", Number(bal.available_balance) === 700);

await expectError("overdraft rejected (WL001)", `select app.post_entry('${w1}','debit',800,'purchase','air-2','Airtime')`, "WL001");
const replay = await one(`select * from app.post_entry($1,'credit',1000,'deposit','dep-1','Bank deposit')`, [w1]);
const bal2 = await one(`select available_balance from app.wallets where id=$1`, [w1]);
ok("replaying a reference is a no-op", replay.id === c1.id && Number(bal2.available_balance) === 700);
await expectError("reusing a reference for another amount (WL003)", `select app.post_entry('${w1}','credit',5000,'deposit','dep-1','x')`, "WL003");
await expectError("3-decimal amount rejected (WL006)", `select app.post_entry('${w1}','credit',1.005,'deposit','dep-x','x')`, "WL006");
await expectError("zero amount rejected (WL006)", `select app.post_entry('${w1}','credit',0,'deposit','dep-y','x')`, "WL006");

// Tampering
await expectError("direct balance edit blocked (WL004)", `update app.wallets set available_balance = 999999 where id='${w1}'`, "WL004");
await expectError("wallet can't be created with money (WL004)", `insert into app.wallets (user_id, available_balance) values ('${u2}', 50)`, "");
await expectError("direct ledger insert blocked (WL005)", `insert into app.wallet_ledger (wallet_id,user_id,entry_type,direction,amount,balance_before,balance_after,reference,description) values ('${w1}','${u1}','deposit','credit',5,700,705,'hack','x')`, "WL005");
await expectError("ledger lines can't be edited (WL010)", `update app.wallet_ledger set amount = 1 where reference='dep-1'`, "WL010");
await expectError("ledger lines can't be deleted (WL010)", `delete from app.wallet_ledger where reference='dep-1'`, "WL010");
await expectError("user with money history can't be deleted", `delete from app.users where id='${u1}'`, "23503");
const status = await one(`update app.wallets set status='frozen' where id=$1 returning status`, [w2]);
ok("non-balance wallet fields still editable", status.status === "frozen");
await expectError("frozen wallet can't be debited (WL002)", `select app.post_entry('${w2}','credit',100,'deposit','dep-w2','x'); select app.post_entry('${w2}','debit',50,'purchase','p-w2','x')`, "WL002");

const drift = await one(`select count(*)::int n from app.wallet_drift`);
ok("no wallet/ledger drift", drift.n === 0);

// Daily limit counting: a refunded purchase doesn't count
const orderId = (await one(`select gen_random_uuid() id`)).id;
await db.query(`select app.post_entry($1,'debit',100,'purchase','air-3','Airtime','vtu_order',$2)`, [w1, orderId]);
await db.query(`select app.post_entry($1,'credit',100,'refund','air-3:refund','Refund','vtu_order',$2)`, [w1, orderId]);
const today = await one(`select app.debits_today($1) total`, [u1]);
ok("debits_today = 300 (refunded 100 excluded)", Number(today.total) === 300, `got ${today.total}`);

// KYC
await db.query(`insert into app.kyc_profiles (user_id,bvn_hash,bvn_last4,bvn_status,bvn_verified_at) values ($1,'h1','1234','verified',now())`, [u1]);
await expectError("one verified BVN per account", `insert into app.kyc_profiles (user_id,bvn_hash,bvn_last4,bvn_status,bvn_verified_at) values ('${u2}','h1','1234','verified',now())`, "23505");
await expectError("verified status needs a timestamp", `update app.kyc_profiles set nin_status='verified' where user_id='${u1}'`, "23514");

// VTU orders
await expectError("meter_type only for electricity", `insert into app.vtu_orders (user_id,wallet_id,reference,product,provider,service,recipient,amount,meter_type) values ('${u1}','${w1}','o1','airtime','peyflex','mtn','+2348031234567',100,'prepaid')`, "23514");
await expectError("electricity needs meter_type", `insert into app.vtu_orders (user_id,wallet_id,reference,product,provider,service,recipient,amount) values ('${u1}','${w1}','o2','electricity','peyflex','ikeja','12345678901',1000)`, "23514");
await expectError("refunded status needs a refund entry", `insert into app.vtu_orders (user_id,wallet_id,reference,product,provider,service,recipient,amount,status) values ('${u1}','${w1}','o3','airtime','peyflex','mtn','+2348031234567',100,'refunded')`, "23514");

// Audit log
await db.query(`insert into app.audit_log (action) values ('test')`);
await expectError("audit log is append-only", `delete from app.audit_log`, "WL010");

// Security posture
const rls = await one(`select count(*) filter (where not c.relrowsecurity)::int off, count(*)::int total from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app' and c.relkind='r'`);
ok(`RLS enabled on all ${rls.total} app tables`, rls.off === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
