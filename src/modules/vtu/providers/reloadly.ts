import { env } from "../../../core/config/env.js";
import { ServiceUnavailableError } from "../../../core/errors/AppError.js";
import type { ProviderOutcome } from "./types.js";

// Reloadly airtime for Nigerian numbers (opt-in per customer: users.reloadly_enabled).
const BASE = env.RELOADLY_ENV === "production" ? "https://topups.reloadly.com" : "https://topups-sandbox.reloadly.com";

let cached: { token: string; expiresAt: number } | null = null;

async function token() {
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;
  if (!env.RELOADLY_API_CLIENT || !env.RELOADLY_API_SECRET) {
    throw new ServiceUnavailableError("Airtime is not available yet.");
  }
  const res = await fetch("https://auth.reloadly.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.RELOADLY_API_CLIENT,
      client_secret: env.RELOADLY_API_SECRET,
      grant_type: "client_credentials",
      audience: BASE,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new ServiceUnavailableError("Airtime is temporarily unavailable.");
  const json = (await res.json()) as { access_token: string; expires_in?: number };
  cached = { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return json.access_token;
}

async function call(path: string, init: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/com.reloadly.topups-v1+json",
      Authorization: `Bearer ${await token()}`,
    },
    signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

// `reference` is sent as Reloadly's customIdentifier, which it refuses to reuse,
// so a retried request can never top up twice.
export async function reloadlyAirtime(input: { reference: string; amount: number; mobileNumber: string }): Promise<ProviderOutcome> {
  const local = input.mobileNumber.replace(/^\+234/, "0");
  let r: { status: number; json: any };
  try {
    const op = await call(`/operators/auto-detect/phone/${encodeURIComponent(local)}/countries/NG?suggestedAmountsMap=false`);
    const operatorId = op.json?.operatorId ?? op.json?.id;
    if (op.status >= 400 || !operatorId) {
      return { status: "failed", message: "We couldn't identify the network for this number", raw: op.json };
    }
    r = await call("/topups", {
      method: "POST",
      timeoutMs: 60_000,
      body: {
        operatorId,
        amount: input.amount,
        useLocalAmount: true,
        customIdentifier: input.reference,
        recipientPhone: { countryCode: "NG", number: local },
      },
    });
  } catch (err) {
    if (err instanceof ServiceUnavailableError) throw err;
    return { status: "unknown", message: err instanceof Error ? err.message : String(err), raw: null };
  }

  const status = String(r.json?.status ?? "").toUpperCase();
  const providerReference = r.json?.transactionId ? String(r.json.transactionId) : null;
  if (r.status < 300 && status === "SUCCESSFUL") return { status: "success", providerReference, message: null, raw: r.json };
  if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) {
    return { status: "failed", message: String(r.json?.message ?? "The provider declined this top-up").slice(0, 300), raw: r.json };
  }
  if (status === "FAILED" || status === "REFUNDED") return { status: "failed", providerReference, message: r.json?.message ?? null, raw: r.json };
  return { status: "unknown", providerReference, message: "Awaiting provider confirmation", raw: r.json };
}
