import { env } from "../../../core/config/env.js";
import { ServiceUnavailableError } from "../../../core/errors/AppError.js";
import { ValidationError } from "../../../core/errors/ValidationError.js";
import type { ProviderOutcome } from "./types.js";

// Peyflex (client.peyflex.com.ng): airtime, data, cable TV, electricity.
const LIST_TIMEOUT_MS = 15_000;
const PURCHASE_TIMEOUT_MS = 60_000;

class PeyflexHttpError extends Error {
  constructor(readonly status: number, readonly body: unknown) {
    super(`Peyflex ${status}`);
  }
}

async function request<T = any>(input: {
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
  auth?: boolean;
  timeoutMs?: number;
}): Promise<T> {
  if (input.auth !== false && !env.PEYFLEX_API_TOKEN) {
    throw new ServiceUnavailableError("Bill payments are not available yet.");
  }
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (input.auth !== false) headers.Authorization = `Token ${env.PEYFLEX_API_TOKEN}`;

  const res = await fetch(new URL(input.path, env.PEYFLEX_BASE_URL), {
    method: input.method ?? "GET",
    headers,
    signal: AbortSignal.timeout(input.timeoutMs ?? LIST_TIMEOUT_MS),
    ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new PeyflexHttpError(res.status, json);
  if (json === null) throw new PeyflexHttpError(res.status, null);
  return json as T;
}

const messageOf = (body: any): string | null => {
  const m = body?.message ?? body?.error ?? body?.detail;
  return typeof m === "string" ? m.slice(0, 300) : null;
};

// Prepaid electricity token (field name varies by DisCo).
function findToken(raw: unknown, depth = 0): string | null {
  if (!raw || typeof raw !== "object" || depth > 4) return null;
  for (const [k, v] of Object.entries(raw)) {
    if (/^(token|purchased_code|meter_token|main_token|tokens?_code)$/i.test(k) && (typeof v === "string" || typeof v === "number") && String(v).trim()) {
      return String(v).replace(/^token\s*:\s*/i, "").trim();
    }
  }
  for (const v of Object.values(raw)) {
    const hit = findToken(v, depth + 1);
    if (hit) return hit;
  }
  return null;
}

function findUnits(raw: any): string | null {
  const u = raw?.units ?? raw?.data?.units ?? raw?.unit;
  return u === undefined || u === null ? null : String(u);
}

// A purchase call is classified, never thrown:
//   success  provider confirmed delivery
//   failed   provider rejected the request (4xx / explicit FAILED): nothing delivered
//   unknown  timeout, network or 5xx error: it may or may not have been delivered
async function purchase(path: string, body: Record<string, unknown>): Promise<ProviderOutcome> {
  let resp: any;
  try {
    resp = await request({ path, method: "POST", body, timeoutMs: PURCHASE_TIMEOUT_MS });
  } catch (err) {
    if (err instanceof PeyflexHttpError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) {
      return { status: "failed", message: messageOf(err.body) ?? "The provider declined this purchase", raw: err.body };
    }
    if (err instanceof ServiceUnavailableError) throw err;
    return { status: "unknown", message: err instanceof Error ? err.message : String(err), raw: err instanceof PeyflexHttpError ? err.body : null };
  }
  const status = String(resp?.status ?? "").toUpperCase();
  const providerReference = resp?.reference ? String(resp.reference) : resp?.data?.reference ? String(resp.data.reference) : null;
  const message = messageOf(resp);
  if (status === "SUCCESS" || status === "SUCCESSFUL") {
    return { status: "success", providerReference, message, raw: resp, token: findToken(resp), units: findUnits(resp) };
  }
  if (status === "FAILED" || status === "FAIL") return { status: "failed", providerReference, message, raw: resp };
  return { status: "unknown", providerReference, message: message ?? "Awaiting provider confirmation", raw: resp };
}

const asArray = (v: any, ...keys: string[]): any[] => {
  if (Array.isArray(v)) return v;
  for (const k of keys) if (Array.isArray(v?.[k])) return v[k];
  return [];
};

// Peyflex rejects bad verify input with 4xx: surface it as a validation error.
async function verify<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof PeyflexHttpError && err.status < 500) {
      throw new ValidationError(messageOf(err.body) ?? "We couldn't verify those details");
    }
    throw err;
  }
}

export const peyflex = {
  async networks() {
    const [airtime, data] = await Promise.all([
      request({ path: "/api/airtime/networks/", auth: true }),
      request({ path: "/api/data/networks/", auth: true }),
    ]);
    return { airtimeNetworks: asArray(airtime, "networks"), dataNetworks: asArray(data, "networks") };
  },

  async dataPlans(network: string) {
    const resp = await request({ path: `/api/data/plans/?${new URLSearchParams({ network })}`, auth: false });
    return asArray(resp, "plans");
  },

  async cableProviders() {
    return asArray(await request({ path: "/api/cable/providers/", auth: false }), "providers");
  },

  async cablePlans(identifier: string) {
    return asArray(await request({ path: `/api/cable/plans/${encodeURIComponent(identifier)}/`, auth: false }), "plans");
  },

  async electricityPlans() {
    return asArray(await request({ path: `/api/electricity/plans/?${new URLSearchParams({ identifier: "electricity" })}`, auth: false }), "plans");
  },

  verifyCable(input: { identifier: string; iuc: string }) {
    return verify(() => request({ path: "/api/cable/verify/", method: "POST", body: input, auth: true }));
  },

  verifyMeter(input: { meter: string; plan: string; type: string }) {
    const qs = new URLSearchParams({ identifier: "electricity", ...input });
    return verify(() => request({ path: `/api/electricity/verify/?${qs}`, auth: false }));
  },

  buyAirtime: (i: { network: string; amount: number; mobileNumber: string }) =>
    purchase("/api/airtime/topup/", { network: i.network, amount: i.amount, mobile_number: i.mobileNumber }),

  buyData: (i: { network: string; planCode: string; mobileNumber: string }) =>
    purchase("/api/data/purchase/", { network: i.network, plan_code: i.planCode, mobile_number: i.mobileNumber }),

  buyCable: (i: { identifier: string; plan: string; iuc: string; phone: string; amount: number }) =>
    purchase("/api/cable/subscribe/", { identifier: i.identifier, plan: i.plan, iuc: i.iuc, phone: i.phone, amount: String(i.amount) }),

  buyElectricity: (i: { meter: string; plan: string; amount: number; type: string; phone: string }) =>
    purchase("/api/electricity/subscribe/", { identifier: "electricity", meter: i.meter, plan: i.plan, amount: String(i.amount), type: i.type, phone: i.phone }),
};
