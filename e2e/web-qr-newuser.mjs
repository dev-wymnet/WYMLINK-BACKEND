// An attendee with no account scans a business QR with the phone camera: /pay/<code> →
// "Create a free account" → sign-up → PIN → back on the pay page, ready to pay. Then the
// admin downloads the QR poster. Local website + local backend only.
import { chromium } from "playwright-core";
import { statSync } from "node:fs";
const out = process.argv[2];
const WEB = "http://localhost:3005";
const API = "http://localhost:4000/api/v1";
const api = async (method, path, token, body) => {
  const r = await fetch(`${API}${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const admin = (await api("POST", "/admin/auth/login", null, { email: "admin@test.local", password: "Admin-Pass-12345!" })).json.accessToken;
const biz = (await api("GET", "/admin/businesses", admin)).json.businesses.find((b) => b.account && b.active);
console.log("business:", biz.name, biz.code);

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 200)));
await page.goto(`${WEB}/pay/${biz.code}`, { waitUntil: "networkidle", timeout: 180000 });
await page.waitForTimeout(1000);
await page.screenshot({ path: `${out}-1-scanned.png` });
await page.getByRole("link", { name: "Create a free account" }).click();
await page.waitForURL(/auth\/signup/, { timeout: 60000 });
const run = Date.now().toString().slice(-7);
await page.getByLabel("First name").fill("Scan");
await page.getByLabel("Last name").fill("Newcomer");
await page.getByLabel("Email address").fill(`scan.${run}@test.local`);
await page.getByLabel("Phone number").fill(`0816${run}`);
await page.getByRole("textbox", { name: "Password" }).fill("Passw0rd!long");
const terms = page.getByRole("checkbox");
if (await terms.count()) await terms.first().check().catch(() => {});
await page.getByRole("button", { name: "Create account" }).click();
await page.waitForURL(/onboarding/, { timeout: 60000 });
await page.getByRole("button", { name: /let.s go/i }).click();
await page.keyboard.type("1357", { delay: 60 });
await page.waitForTimeout(400);
await page.keyboard.type("1357", { delay: 60 });
await page.getByRole("button", { name: "Continue" }).click({ timeout: 30000 });
await page.waitForURL(new RegExp(`/pay/${biz.code}$`), { timeout: 30000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}-2-back-on-pay.png` });
const amountField = await page.getByLabel("Amount").count();
console.log("back on the pay page after sign-up + PIN:", page.url().endsWith(`/pay/${biz.code}`), "| amount field shown:", amountField > 0);

// Admin downloads the QR poster.
const adm = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
await adm.goto(`${WEB}/admin/login`, { waitUntil: "networkidle" });
await adm.getByLabel("Work email").fill("admin@test.local");
await adm.getByRole("textbox", { name: "Password" }).fill("Admin-Pass-12345!");
await adm.getByRole("button", { name: "Continue" }).click();
await adm.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });
await adm.goto(`${WEB}/admin/businesses`, { waitUntil: "networkidle" });
await adm.getByRole("button", { name: "Show QR code" }).first().click({ timeout: 30000 });
const [dl] = await Promise.all([adm.waitForEvent("download", { timeout: 30000 }), adm.getByRole("button", { name: "Download poster" }).click()]);
const file = `${out}-3-poster.png`;
await dl.saveAs(file);
console.log("poster downloaded:", dl.suggestedFilename(), statSync(file).size, "bytes");
console.log("errors:", errors.length ? errors.join("\n") : "none");
await browser.close();
