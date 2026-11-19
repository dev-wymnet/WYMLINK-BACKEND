// Account deletion against the local stack (backend :4000, helper :4591).
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
const run = Date.now().toString().slice(-6);
const ref = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
async function customer(tag, tail) {
  const email = `del.${tag}.${run}@test.local`;
  const phone = `+23482${run.slice(-1)}${tail}`;
  const r = await call("POST", "/auth/signup", null, { firstName: `Del${tag}`, lastName: "Customer", email, phone, password: "Passw0rd!long" });
  const token = r.json.accessToken ?? r.json.tokens?.accessToken;
  await call("POST", "/auth/pin/transaction/set", token, { pin: "1357" });
  let va = await call("GET", "/wallets/virtual-account", token);
  for (let i = 0; i < 20 && !va.json?.account; i++) { await sleep(300); va = await call("GET", "/wallets/virtual-account", token); }
  return { token, email, phone, id: r.json.user?.id, account: va.json?.account?.accountNumber };
}
const balance = async (c) => Number((await call("GET", "/wallets/me", c.token)).json?.balance ?? NaN);

console.log("== Empty account: deleted");
const A = await customer("a", "3330001");
const wrong = await call("POST", "/user/me/delete", A.token, { password: "not-it" });
ok(wrong.status === 400 && /password/i.test(JSON.stringify(wrong.json)), "wrong password refused", wrong.json);
const del = await call("POST", "/user/me/delete", A.token, { password: "Passw0rd!long" });
ok(del.status === 200 && del.json?.deleted === true, "account deleted", del.json);
const after = await call("GET", "/user/me", A.token);
ok(after.status === 401, "old session no longer works", after.status);
const login = await call("POST", "/auth/login", null, { identifier: A.email, email: A.email, password: "Passw0rd!long" });
ok(login.status >= 400, "can't sign in with the old email and password", login.status);
const [row] = await sql("select first_name, last_name, email, phone, status, closed_at is not null closed, transaction_pin_hash is null no_pin from app.users where id = $1", [A.id]);
ok(row?.first_name === "Deleted" && row?.phone === null && /deleted\.wymlink\.invalid$/.test(row?.email) && row?.status === "closed" && row?.closed && row?.no_pin, "name, email, phone and PIN wiped; account closed", row);
const audit = await sql("select count(*)::int n from app.audit_log where action = 'ACCOUNT_DELETED' and target_id = $1", [A.id]);
ok(audit[0].n === 1, "deletion recorded in the audit log");
const again = await customer("a2", "3330001");
ok(Boolean(again.token), "the same phone number can sign up again afterwards");

console.log("== Money in the account: refused");
const B = await customer("b", "3330002");
await helper("/moneta/credit", { accountNumber: B.account, amount: 1000 });
await call("POST", "/webhooks/moneta", null, { notification_type: "virtual_account_static", payment: { reference: ref("pay") }, virtualAccount: { account_number: B.account } });
for (let i = 0; i < 30 && (await balance(B)) < 1000; i++) await sleep(300);
const refused = await call("POST", "/user/me/delete", B.token, { password: "Passw0rd!long" });
ok(refused.status === 400 && /1,000\.00/.test(JSON.stringify(refused.json)) && /bank/.test(JSON.stringify(refused.json)), "refused with the balance and what to do", refused.json);
const still = await call("GET", "/user/me", B.token);
ok(still.status === 200 && still.json?.user?.firstName === "Delb", "account untouched", still.json?.user?.firstName);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
