import { eq } from "drizzle-orm";

import { env } from "../../core/config/env.js";
import { db } from "../../core/db/client.js";
import { providerTokens } from "../../core/db/schema.js";
import { ServiceUnavailableError } from "../../core/errors/AppError.js";
import { logger } from "../../core/logger/logger.js";
import {
  MonetaError,
  forgetToken,
  isMonetaSuccess,
  looksLikeTokenRejection,
  monetaFetch,
  sharedToken,
  type MonetaResponse,
} from "./moneta.http.js";

// Moneta partner (payment gateway) API: virtual accounts, deposits, payouts,
// VA-to-VA transfers. Reference: docs/moneta/third_party_api.postman_collection.json.
// Paths use the /partner prefix (the form Etico runs in production).
const PROVIDER = "moneta_partner";

export const monetaPartnerConfigured = () => Boolean(env.MONETA_PARTNER_CLIENT_ID && env.MONETA_PARTNER_CLIENT_SECRET);

function requireConfigured() {
  if (!monetaPartnerConfigured()) throw new ServiceUnavailableError("Bank accounts and transfers are not available yet.");
}

async function mint() {
  const basic = Buffer.from(`${env.MONETA_PARTNER_CLIENT_ID}:${env.MONETA_PARTNER_CLIENT_SECRET}`).toString("base64");
  const r = await monetaFetch(`${env.MONETA_PARTNER_URL}/partner/auth/access-token`, {
    method: "GET",
    headers: { Accept: "application/json", Authorization: `Basic ${basic}` },
    timeoutMs: 60_000,
  });
  const token = r.json?.data?.access_token;
  if (!isMonetaSuccess(r.json?.status) || typeof token !== "string") {
    logger.error({ http: r.status, message: r.json?.message }, "moneta_partner_token_failed");
    throw new MonetaError("Payments are temporarily unavailable. Please try again shortly.", 503, null);
  }
  const exp = Date.parse(String(r.json?.data?.expires_at ?? ""));
  // Refresh a few minutes early.
  return { token, expiresAt: Number.isFinite(exp) ? new Date(exp - 5 * 60_000) : null };
}

async function call(method: "GET" | "POST", path: string, body?: object, timeoutMs = 90_000): Promise<MonetaResponse> {
  requireConfigured();
  let token = await sharedToken(PROVIDER, mint);
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await monetaFetch(`${env.MONETA_PARTNER_URL}${path}`, {
      method,
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      timeoutMs,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    // An expired/replaced token is rejected before anything is processed: safe to retry once.
    if (attempt === 0 && looksLikeTokenRejection(r)) {
      forgetToken(PROVIDER, token);
      token = await sharedToken(PROVIDER, mint, token);
      continue;
    }
    // Shape and status only: never log account numbers, names or BVN/NIN.
    logger.info({ method, path: path.split("?")[0], http: r.status, ok: isMonetaSuccess(r.json?.status) }, "moneta_partner_call");
    return r;
  }
  throw new MonetaError("Payments are temporarily unavailable. Please try again shortly.", 503, null);
}

const ok = (r: MonetaResponse) => r.status >= 200 && r.status < 300 && isMonetaSuccess(r.json?.status);
const messageOf = (r: MonetaResponse) => (typeof r.json?.message === "string" ? r.json.message.slice(0, 300) : null);

// Moneta sends amounts as numbers or text, sometimes with thousands commas ("1,990.00").
export function monetaAmount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const t = v.replace(/[\s,₦]/g, "").replace(/^NGN/i, "");
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

const list = (data: unknown): Array<Record<string, any>> =>
  Array.isArray(data) ? data : data && typeof data === "object" ? [data as Record<string, any>] : [];

const ymd = (d: Date) => d.toISOString().slice(0, 10);

// ---------- Virtual accounts ----------

// Moneta's field rules, which its docs don't state (learned by Etico in production):
// names are letters only, account_name is at most 8 characters, and `nin` takes the
// documented 10-digit placeholder — the account is opened against the BVN.
const NIN_PLACEHOLDER = "0000000000";
const lettersOnly = (s: string) => s.normalize("NFD").replace(/[^A-Za-z]/g, "");

// Moneta's validation refusals carry the reasons per field ({errors: {bvn: ["..."]}}).
function fieldErrorsOf(r: MonetaResponse) {
  const e = r.json?.errors ?? (r.json?.status === false ? r.json?.data : null);
  if (!e || typeof e !== "object" || Array.isArray(e)) return null;
  const parts = Object.entries(e as Record<string, unknown>)
    .map(([field, v]) => `${field}: ${(Array.isArray(v) ? v : [v]).map(String).join(", ")}`)
    .filter((s) => s.length > 2);
  return parts.length ? parts.join("; ").slice(0, 300) : null;
}

export async function createVirtualAccount(input: { firstName: string; surname: string; bvn: string }) {
  const first = lettersOnly(input.firstName) || lettersOnly(input.surname) || "User";
  const last = lettersOnly(input.surname) || first;
  const r = await call("POST", "/partner/virtual-accounts", {
    account_name: first.slice(0, 8),
    account_type: "static",
    surname: last,
    first_name: first,
    bvn: input.bvn,
    nin: NIN_PLACEHOLDER,
  });
  const d = r.json?.data ?? {};
  if (!ok(r) || !d.virtual_account_reference || !/^\d{10}$/.test(String(d.account_number ?? ""))) {
    const fields = fieldErrorsOf(r);
    const message = [messageOf(r), fields].filter(Boolean).join(" — ") || "Moneta couldn't create the account";
    return { ok: false as const, message, raw: r.json };
  }
  return {
    ok: true as const,
    reference: String(d.virtual_account_reference),
    accountNumber: String(d.account_number),
    accountName: String(d.account_name ?? ""),
    bankName: String(d.bank_name ?? ""),
    raw: d,
  };
}

export async function getVirtualAccountBalance(reference: string) {
  const r = await call("GET", `/partner/virtual-accounts/account-balance?${new URLSearchParams({ virtual_account_reference: reference })}`);
  return ok(r) ? monetaAmount(r.json?.data?.balance) : null;
}

// Diagnostics: Moneta's raw answers for one VA's balance and recent history (read-only).
export async function inspectVirtualAccount(reference: string, days: number) {
  const qs = new URLSearchParams({ virtual_account_reference: reference, fromDate: ymd(new Date(Date.now() - days * 86_400_000)), toDate: ymd(new Date(Date.now() + 86_400_000)) });
  const balance = await call("GET", `/partner/virtual-accounts/account-balance?${new URLSearchParams({ virtual_account_reference: reference })}`);
  const history = await call("GET", `/partner/virtual-accounts/transaction-histories?${qs}`);
  return { balance: { http: balance.status, body: balance.json }, history: { http: history.status, body: history.json } };
}

export type MonetaCredit = {
  reference: string;
  virtualAccountReference: string | null;
  amountPaid: number;
  fee: number;
  amountSettled: number;
  paidAt: Date | null;
  senderName: string | null;
  raw: Record<string, any>;
};

// Credits (incoming bank transfers) into one VA. Moneta has been seen to ignore the
// reference filter and return every VA's history, so items naming another VA are dropped.
export async function listCredits(reference: string, from: Date, to: Date): Promise<MonetaCredit[]> {
  const qs = new URLSearchParams({ virtual_account_reference: reference, fromDate: ymd(from), toDate: ymd(to) });
  const r = await call("GET", `/partner/virtual-accounts/transaction-histories?${qs}`);
  if (!ok(r)) throw new MonetaError(messageOf(r) ?? "Couldn't read the account history", r.status, null);
  const out: MonetaCredit[] = [];
  for (const t of list(r.json?.data)) {
    const action = String(t.action_type ?? t.type ?? "credit").toLowerCase();
    if (action.includes("debit")) continue;
    if (String(t.status ?? "success").toLowerCase() === "failed") continue;
    const va = t.virtual_account_reference ? String(t.virtual_account_reference) : null;
    if (va && va !== reference) continue;
    const paid = monetaAmount(t.amount_paid ?? t.amount);
    const settled = monetaAmount(t.amount_settled ?? t.amount_paid ?? t.amount);
    if (!t.reference || paid === null || settled === null || settled <= 0) continue;
    const at = Date.parse(String(t.paid_at ?? t.created_at ?? "").replace(" ", "T"));
    out.push({
      reference: String(t.reference),
      virtualAccountReference: va,
      amountPaid: paid,
      fee: monetaAmount(t.transaction_fee) ?? Math.max(0, paid - settled),
      amountSettled: settled,
      paidAt: Number.isFinite(at) ? new Date(at) : null,
      senderName: typeof t.merchant_name === "string" && t.merchant_name.trim() ? t.merchant_name.trim().slice(0, 200) : null,
      raw: t,
    });
  }
  return out;
}

// ---------- Banks & name enquiry ----------

// The bank list barely changes: kept 24 h, in memory and in app.provider_tokens (row
// "moneta_banks", list as JSON), so restarts and other instances don't spend a proxy request.
type BankList = Array<{ code: string; name: string }>;
const BANKS_TTL_MS = 24 * 60 * 60_000;
const BANKS_ROW = "moneta_banks";
let bankCache: { until: number; banks: BankList } | null = null;

export async function listBanks() {
  if (bankCache && Date.now() < bankCache.until) return bankCache.banks;
  const [row] = await db.select().from(providerTokens).where(eq(providerTokens.provider, BANKS_ROW)).limit(1);
  if (row?.token && row.expiresAt && row.expiresAt.getTime() > Date.now()) {
    bankCache = { until: row.expiresAt.getTime(), banks: JSON.parse(row.token) as BankList };
    return bankCache.banks;
  }
  const r = await call("GET", "/partner/virtual-accounts/banks");
  if (!ok(r)) throw new MonetaError(messageOf(r) ?? "Couldn't load banks", r.status, null);
  const banks = list(r.json?.data)
    .filter((b) => b.id !== undefined && b.bank_name)
    .map((b) => ({ code: String(b.id), name: String(b.bank_name).trim() }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const until = new Date(Date.now() + BANKS_TTL_MS);
  bankCache = { until: until.getTime(), banks };
  await db
    .insert(providerTokens)
    .values({ provider: BANKS_ROW, token: JSON.stringify(banks), expiresAt: until, mintedAt: new Date() })
    .onConflictDoUpdate({ target: providerTokens.provider, set: { token: JSON.stringify(banks), expiresAt: until, mintedAt: new Date() } })
    .catch((err) => logger.warn({ err: (err as Error).message }, "moneta_banks_store_failed"));
  return banks;
}

export async function resolveAccount(bankId: string, accountNumber: string) {
  const r = await call("GET", `/partner/virtual-accounts/account/resolve?${new URLSearchParams({ account_number: accountNumber, bank_id: bankId })}`);
  const name = r.json?.data?.account_name;
  if (!ok(r) || typeof name !== "string" || !name.trim()) return null;
  return name.trim().slice(0, 200);
}

// ---------- Payouts ----------

export type MoneyOutcome = {
  status: "success" | "failed" | "unknown";
  providerReference: string | null;
  fee: number | null;
  message: string | null;
  raw: unknown;
};

// One payout from one VA. Moneta takes its fee from the VA on top of `amount`.
// Never retried: a timeout or 5xx is "unknown" and is settled from payout history.
export async function payout(input: {
  sourceReference: string;
  bankId: string;
  accountNumber: string;
  amount: number;
  narration: string;
}): Promise<MoneyOutcome> {
  let r: MonetaResponse;
  try {
    r = await call("POST", "/partner/virtual-accounts/payout", {
      beneficiary_bank_id: Number(input.bankId),
      beneficiary_account_number: input.accountNumber,
      amount: input.amount,
      narration: input.narration,
      source_virtual_accounts: [{ virtual_account_reference: input.sourceReference, amount: input.amount }],
    }, 150_000);
  } catch (err) {
    if (err instanceof ServiceUnavailableError) throw err;
    return { status: "unknown", providerReference: null, fee: null, message: (err as Error).message, raw: null };
  }
  return classify(r);
}

function classify(r: MonetaResponse): MoneyOutcome {
  const d = r.json?.data ?? {};
  const providerReference = d.reference ? String(d.reference) : null;
  const fee = monetaAmount(d.transaction_fees ?? d.transaction_fee);
  const state = String(d.status ?? "").toLowerCase();
  if (ok(r) && (state === "success" || state === "successful" || state === "")) {
    return { status: "success", providerReference, fee, message: null, raw: r.json };
  }
  // A clear refusal (4xx, or status false with a message) means nothing was sent.
  if ((r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) || (r.json?.status === false && r.status < 500)) {
    return { status: "failed", providerReference, fee: null, message: messageOf(r) ?? "Declined by the bank", raw: r.json };
  }
  if (state === "failed" || state === "reversed") return { status: "failed", providerReference, fee: null, message: messageOf(r), raw: r.json };
  return { status: "unknown", providerReference, fee, message: messageOf(r) ?? "Awaiting confirmation", raw: r.json };
}

// Finds a payout by the Wymlink reference embedded in its narration.
export async function findPayout(input: { narrationTag: string; since: Date }) {
  const qs = new URLSearchParams({ fromDate: ymd(new Date(input.since.getTime() - 86_400_000)), toDate: ymd(new Date(Date.now() + 86_400_000)) });
  const r = await call("GET", `/partner/virtual-accounts/payout-histories?${qs}`);
  if (!ok(r)) return null;
  const hit = list(r.json?.data).find((p) => String(p.narration ?? "").includes(input.narrationTag));
  if (!hit) return { found: false as const };
  const state = String(hit.status ?? "").toLowerCase();
  return {
    found: true as const,
    status: state === "success" || state === "successful" ? ("success" as const) : state === "failed" || state === "reversed" ? ("failed" as const) : ("unknown" as const),
    providerReference: hit.reference ? String(hit.reference) : null,
  };
}

// ---------- VA → VA transfers ----------

export async function transferBetweenAccounts(input: { sourceAccountNumber: string; destinationAccountNumber: string; amount: number }): Promise<MoneyOutcome> {
  let r: MonetaResponse;
  try {
    r = await call("POST", "/partner/virtual-accounts/transfer", {
      source_virtual_account: input.sourceAccountNumber,
      destination_virtual_account: input.destinationAccountNumber,
      amount: input.amount,
    }, 150_000);
  } catch (err) {
    if (err instanceof ServiceUnavailableError) throw err;
    return { status: "unknown", providerReference: null, fee: null, message: (err as Error).message, raw: null };
  }
  return classify(r);
}
