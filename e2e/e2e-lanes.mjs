// Moneta lanes through a real proxy: while 5 slow account openings (4 s each at the fake
// Moneta) queue on the background tunnel, a business QR payment on the main tunnel must not
// wait behind them.
const API = "http://localhost:4000/api/v1";
const H = "http://localhost:4591";
let pass = 0, fail = 0;
const ok = (c, label, extra) => { if (c) { pass++; console.log("  ok  ", label); } else { fail++; console.log("  FAIL", label, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ""); } };
const post = (u, b, t) => fetch(u, { method: "POST", headers: { "content-type": "application/json", ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const get = (u, t) => fetch(u, { headers: t ? { authorization: `Bearer ${t}` } : {} }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = Date.now().toString().slice(-5);

const admin = (await post(`${API}/admin/auth/login`, { email: "admin@test.local", password: "Admin-Pass-12345!" })).json.accessToken;
// A payer with an account number and money, and a business (both opened before the rush).
const payer = await post(`${API}/auth/signup`, { firstName: "Payer", lastName: "Lane", email: `payer.${run}@test.local`, phone: `+23490${run}111`, password: "Passw0rd!long" });
const pt = payer.json.accessToken;
await post(`${API}/auth/pin/transaction/set`, { pin: "2468" }, pt);
let va = null;
for (let i = 0; i < 40 && !va; i++) { va = (await get(`${API}/wallets/virtual-account`, pt)).json?.account; if (!va) await sleep(250); }
ok(Boolean(va), "payer's account number opened through the proxy", va);
const biz = (await post(`${API}/admin/businesses`, { name: "Lane Cafe" }, admin)).json?.business;
ok(Boolean(biz?.account?.accountNumber), "business account opened through the proxy", biz);
await post(`${H}/moneta/credit`, { accountNumber: va.accountNumber, amount: 2000 });
await post(`${API}/webhooks/moneta`, { notification_type: "virtual_account_static", payment: { reference: `lane-${run}` }, virtualAccount: { account_number: va.accountNumber } });
for (let i = 0; i < 20; i++) { if (Number((await get(`${API}/wallets/me`, pt)).json?.balance) >= 2000) break; await sleep(300); }

// The rush: 5 sign-ups whose account openings each take 4 s at Moneta (20 s queued).
await post(`${H}/moneta/mode`, { createDelayMs: 4000 });
const rushers = [];
for (let i = 0; i < 5; i++) rushers.push((await post(`${API}/auth/signup`, { firstName: "Rush", lastName: `L${i}`, email: `lane.${run}.${i}@test.local`, phone: `+23490${run}2${i}0`, password: "Passw0rd!long" })).json.accessToken);
await sleep(300); // openings are now queued on the background tunnel

const t0 = Date.now();
const pay = await post(`${API}/businesses/${biz.code}/pay`, { amount: 300, transactionPin: "2468", reference: `lane-pay-${run}` }, pt);
const payMs = Date.now() - t0;
ok(pay.json?.transfer?.status === "success", `QR payment succeeded during the opening rush (${payMs} ms)`, pay.json);
ok(payMs < 4000, "the payment did not wait behind the queued account openings", payMs);

// The openings still all complete (in the background).
const t1 = Date.now();
let opened = 0;
for (let round = 0; round < 60 && opened < 5; round++) {
  opened = 0;
  for (const t of rushers) if ((await get(`${API}/wallets/virtual-account`, t)).json?.account) opened++;
  if (opened < 5) await sleep(1000);
}
ok(opened === 5, `all 5 queued account numbers opened (${Math.round((Date.now() - t1) / 1000)} s after the payment)`, opened);
await post(`${H}/moneta/mode`, { createDelayMs: 0 });
const stats = await (await fetch("http://localhost:4596/__stats")).json();
ok(stats.tunnels >= 2 && stats.tunnels <= 6, `calls reused a couple of long-lived tunnels (${stats.tunnels} opened)`, stats);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
