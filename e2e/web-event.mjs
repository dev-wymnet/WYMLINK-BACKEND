// Website, phone-sized, against the local backend: sign-up → PIN → event popup → free data →
// history; business pay page; admin event and businesses pages. Screens in <out>-*.png.
import { chromium } from "playwright-core";
const out = process.argv[2];
const WEB = "http://localhost:3005";
const API = "http://localhost:4000/api/v1";
const log = (...a) => console.log(...a);
const json = async (method, path, token, body) => {
  const r = await fetch(`${API}${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const admin = (await json("POST", "/admin/auth/login", null, { email: "admin@test.local", password: "Admin-Pass-12345!" })).json.accessToken;
const ov = await json("GET", "/admin/promo", admin);
if (!ov.json.active) await json("POST", "/admin/promo", admin, { title: "Wymlink Launch Day", message: "Free data, airtime and TV today, on us! No money needed in your account.", dataMax: 8000, airtimeMax: 5000, tvPlans: ["gotv-easy", "dstv-starter36"], tvPerProvider: 1, budget: null });
const bizList = (await json("GET", "/admin/businesses", admin)).json.businesses;
const biz = bizList.find((b) => b.account && b.active) ?? (await json("POST", "/admin/businesses", admin, { name: "Wymnet Cafe" })).json.business;

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [];
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 200)));
page.on("console", (m) => m.type() === "error" && !/Failed to load resource|favicon|hydrat/i.test(m.text()) && errors.push(m.text().slice(0, 200)));

const run = Date.now().toString().slice(-7);
await page.goto(`${WEB}/auth/signup`, { waitUntil: "networkidle", timeout: 120000 });
await page.getByLabel("First name").fill("Ada");
await page.getByLabel("Last name").fill("Event");
await page.getByLabel("Email address").fill(`ada.${run}@test.local`);
await page.getByLabel("Phone number").fill(`080${run}1`.slice(0, 11));
await page.getByRole("textbox", { name: "Password" }).fill("Passw0rd!long");
const terms = page.getByRole("checkbox");
if (await terms.count()) await terms.first().check().catch(() => {});
await page.getByRole("button", { name: "Create account" }).click();
await page.waitForURL(/onboarding/, { timeout: 60000 });
await page.screenshot({ path: `${out}-1-onboarding.png` });
await page.getByRole("button", { name: /let.s go/i }).click();
await page.keyboard.type("1357");
await page.waitForTimeout(400);
await page.keyboard.type("1357");
await page.getByRole("button", { name: "Continue" }).click({ timeout: 30000 });
await page.waitForURL(/\/dashboard$/, { timeout: 30000 });
await page.getByRole("dialog").waitFor({ timeout: 30000 });
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}-2-popup.png` });
log("popup:", (await page.getByRole("dialog").innerText()).replace(/\s+/g, " ").slice(0, 200));
await page.getByRole("button", { name: "Start buying" }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}-3-dashboard.png`, fullPage: true });
const acct = await page.locator("text=/\\b9\\d{9}\\b/").first().textContent({ timeout: 20000 }).catch(() => null);
log("account number on dashboard:", acct);

// Free data
await page.goto(`${WEB}/dashboard/airtime?tab=data`, { waitUntil: "networkidle" });
await page.getByLabel("Phone number").fill(`0803${run}`);
await page.getByRole("button", { name: /MTN/ }).first().click();
await page.getByRole("button", { name: /10GB/ }).first().click({ timeout: 20000 });
await page.screenshot({ path: `${out}-4-data.png`, fullPage: true });
await page.getByRole("button", { name: /Get 10GB free/ }).click();
await page.getByRole("dialog").waitFor();
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}-5-pin.png` });
await page.keyboard.type("1357", { delay: 80 });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}-5b-after-pin.png` });
log("after pin:", (await page.locator("body").innerText()).replace(/s+/g, " ").slice(-300));
if (await page.getByRole("button", { name: "Confirm" }).isEnabled().catch(() => false)) await page.getByRole("button", { name: "Confirm" }).click();
await page.getByText(/data sent|is processing|failed/i).first().waitFor({ timeout: 30000 });
await page.screenshot({ path: `${out}-6-done.png` });
log("data outcome:", (await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 160));

// History shows it as Free
await page.goto(`${WEB}/dashboard/transactions`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}-7-history.png`, fullPage: true });
log("history has Free row:", await page.getByText(/^Free 10GB|Free\s/).count());

// TV page with free plan
await page.goto(`${WEB}/dashboard/bills/cable?provider=gotv`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}-8-tv.png`, fullPage: true });

// Business pay page (signed in, zero balance)
await page.goto(`${WEB}/pay/${biz.code}`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}-9-pay.png`, fullPage: true });

// Same pay page signed out
const anon = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await anon.goto(`${WEB}/pay/${biz.code}`, { waitUntil: "networkidle" });
await anon.waitForTimeout(600);
await anon.screenshot({ path: `${out}-10-pay-signedout.png` });

// Admin console
const adm = await browser.newPage({ viewport: { width: 1280, height: 900 } });
adm.on("pageerror", (e) => errors.push("admin pageerror: " + e.message.slice(0, 200)));
await adm.goto(`${WEB}/admin/login`, { waitUntil: "networkidle" });
await adm.getByLabel("Work email").fill("admin@test.local");
await adm.getByRole("textbox", { name: "Password" }).fill("Admin-Pass-12345!");
await adm.getByRole("button", { name: "Continue" }).click();
await adm.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });
await adm.goto(`${WEB}/admin/event`, { waitUntil: "networkidle" });
await adm.waitForTimeout(1500);
await adm.screenshot({ path: `${out}-11-admin-event.png`, fullPage: true });
await adm.goto(`${WEB}/admin/businesses`, { waitUntil: "networkidle" });
await adm.waitForTimeout(1200);
await adm.getByRole("button", { name: "Show QR code" }).first().click();
await adm.waitForTimeout(600);
await adm.screenshot({ path: `${out}-12-admin-qr.png` });
const admPhone = await browser.newPage({ viewport: { width: 390, height: 844 } });
await admPhone.context().addCookies(await adm.context().cookies());
await admPhone.goto(`${WEB}/admin/event`, { waitUntil: "networkidle" });
await admPhone.waitForTimeout(1500);
await admPhone.screenshot({ path: `${out}-13-admin-event-phone.png`, fullPage: true });

const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
log("horizontal overflow on last customer page:", overflow);
log("errors:", errors.length ? errors.join("\n") : "none");
await browser.close();
