// The mobile app (web target) against the local backend: sign-up → passcode → PIN → event
// popup → free data → scan-to-pay a business by code → PIN → paid. Screens in <out>-*.png.
import { chromium } from "playwright-core";
const out = process.argv[2];
const APP = "http://localhost:8081";
const API = "http://localhost:4000/api/v1";
const H = "http://localhost:4591";
const log = (...a) => console.log(...a);
const api = async (method, path, token, body) => {
  const r = await fetch(`${API}${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const admin = (await api("POST", "/admin/auth/login", null, { email: "admin@test.local", password: "Admin-Pass-12345!" })).json.accessToken;
if (!(await api("GET", "/admin/promo", admin)).json.active)
  await api("POST", "/admin/promo", admin, { title: "Wymlink Launch Day", message: "Free data, airtime and TV today, on us! No money needed in your account.", dataMax: 8000, airtimeMax: 5000, tvPlans: ["gotv-easy", "dstv-starter36"], tvPerProvider: 1, budget: null });
const biz = (await api("GET", "/admin/businesses", admin)).json.businesses.find((b) => b.account && b.active) ?? (await api("POST", "/admin/businesses", admin, { name: "Wymnet Cafe" })).json.business;
log("business:", biz.name, biz.code);

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 200)));
const shot = (n) => page.screenshot({ path: `${out}-${n}.png` });
const keypad = async (digits) => { for (const d of digits) { await page.getByRole("button", { name: d, exact: true }).last().click(); await page.waitForTimeout(120); } };

await page.goto(APP, { waitUntil: "networkidle", timeout: 300000 });
await page.waitForTimeout(3000);
await page.getByRole("button", { name: "Continue to create an account" }).click({ timeout: 60000 });
const run = Date.now().toString().slice(-7);
const phone = `0805${run}`;
await page.getByLabel("First name").fill("Bola");
await page.getByLabel("Last name").fill("Appuser");
await page.getByLabel("Email").fill(`bola.${run}@test.local`);
await page.getByLabel("Phone number").fill(phone);
await page.getByLabel("Password", { exact: true }).fill("Passw0rd!long");
await page.getByLabel("Confirm password").fill("Passw0rd!long");
await page.getByRole("button", { name: "Sign up" }).last().click();
await page.waitForTimeout(2500);
await shot("1-after-signup");
// Passcode (6 digits, twice), then PIN (4 digits, twice), then skip biometrics.
await keypad("135790"); await page.waitForTimeout(600); await keypad("135790"); await page.waitForTimeout(1500);
await shot("2-after-passcode");
await keypad("2468"); await page.waitForTimeout(600); await keypad("2468"); await page.waitForTimeout(1500);
const notNow = page.getByRole("button", { name: "Not now" });
if (await notNow.count()) await notNow.click();
await page.waitForTimeout(3000);
await shot("3-home-popup");
const popupText = await page.getByText("Everything below is on us today").count();
log("event popup shown:", popupText > 0);
await page.getByRole("button", { name: "Start buying" }).click({ timeout: 15000 });
await page.waitForTimeout(800);
await shot("4-home");

// Free data
await page.getByRole("button", { name: /^Data/ }).first().click();
await page.waitForTimeout(1500);
await page.getByLabel("Phone number").fill(`0803${run}`);
await page.getByRole("radio", { name: /MTN/ }).first().click();
await page.waitForTimeout(1500);
await page.getByRole("radio", { name: /10GB/ }).first().click();
await page.waitForTimeout(500);
await shot("5-data-free");
await page.getByRole("button", { name: /Get 10GB free/ }).click();
await page.waitForTimeout(1200);
await shot("6-pin-sheet");
await keypad("2468");
await page.getByText(/Data sent|processing|failed/).first().waitFor({ timeout: 30000 });
await page.waitForTimeout(500);
await shot("7-data-done");
log("data outcome:", (await page.getByText(/is on its way|failed|processing/).first().textContent()) ?? "");

// Fund the customer so they can pay a business: money lands at (fake) Moneta, then the
// notification credits the wallet.
const login = await api("POST", "/auth/login", null, { email: `bola.${run}@test.local`, password: "Passw0rd!long" });
let va = null;
for (let i = 0; i < 20 && !va; i++) { va = (await api("GET", "/wallets/virtual-account", login.json.accessToken)).json?.account; if (!va) await new Promise((r) => setTimeout(r, 500)); }
await fetch(`${H}/moneta/credit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountNumber: va.accountNumber, amount: 3000 }) });
await api("POST", "/webhooks/moneta", null, { notification_type: "virtual_account_static", payment: { reference: `pay-${run}` }, virtualAccount: { account_number: va.accountNumber } });
await new Promise((r) => setTimeout(r, 2500));

// Scan to pay (no camera here: type the code)
// In-app navigation (a reload would drop the web build's in-memory session).
await page.goBack();
await page.waitForTimeout(1500);
await page.getByText("Scan to pay", { exact: true }).first().click({ timeout: 20000 });
await page.waitForTimeout(2500);
await shot("8-scan");
await page.getByLabel("Or type the business code").fill(biz.code);
await page.getByRole("button", { name: "Continue" }).last().click();
await page.waitForTimeout(2500);
await shot("9-business");
await page.getByLabel("Amount").fill("500");
await page.getByRole("button", { name: /Pay ₦500/ }).click();
await page.waitForTimeout(1200);
await keypad("2468");
await page.getByText(/Paid |Payment processing|Payment failed/).first().waitFor({ timeout: 30000 });
await page.waitForTimeout(500);
await shot("10-paid");
log("pay outcome:", (await page.getByText(/sent to|Nothing was taken|hasn't confirmed/).first().textContent()) ?? "");

const bizNow = (await api("GET", "/admin/businesses", admin)).json.businesses.find((b) => b.code === biz.code);
log("business received:", bizNow.payments.total, "from", bizNow.payments.count, "payments");
log("errors:", errors.length ? errors.join("\n") : "none");
await browser.close();
