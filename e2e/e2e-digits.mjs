// Moneta refusing digits in the account name: the account still opens, named in letters.
const API = "http://localhost:4000/api/v1", H = "http://localhost:4591";
const post = (u, b, t) => fetch(u, { method: "POST", headers: { "content-type": "application/json", ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(b) }).then((r) => r.json());
await post(`${H}/moneta/mode`, { rejectDigitsInName: true });
await post(`${H}/reset-calls`, {});
const run = Date.now().toString().slice(-7);
const out = [];
for (const tag of ["x", "y"]) {
  const s = await post(`${API}/auth/signup`, { firstName: "Digit", lastName: "Test", email: `dig.${tag}.${run}@test.local`, phone: `+2347${run}${tag === "x" ? "11" : "22"}`, password: "Passw0rd!long" });
  let va = null;
  for (let i = 0; i < 20 && !va; i++) { await new Promise((r) => setTimeout(r, 300)); va = (await fetch(`${API}/wallets/virtual-account`, { headers: { authorization: `Bearer ${s.accessToken}` } }).then((r) => r.json())).account; }
  const me = await fetch(`${API}/user/me`, { headers: { authorization: `Bearer ${s.accessToken}` } }).then((r) => r.json());
  out.push({ code: me.customerCode ?? me.user?.customerCode, accountName: va?.accountName, accountNumber: va?.accountNumber });
}
const calls = (await fetch(`${H}/calls`).then((r) => r.json())).filter((c) => c.to === "moneta" && c.path === "/partner/virtual-accounts").map((c) => c.body.account_name);
await post(`${H}/moneta/mode`, { rejectDigitsInName: false });
console.log(JSON.stringify(out), "\ncreate calls:", JSON.stringify(calls));
const spelt = (s) => s.replace(/\d/g, (d) => String.fromCharCode(65 + Number(d)));
const good = out.every((o) => /^\d{10}$/.test(o.accountNumber) && o.accountName.includes(spelt(o.code))) && calls.length === 3;
console.log(good ? "PASS: opened in letters; first refusal cost one retry, later ones go straight to letters" : "FAIL");
