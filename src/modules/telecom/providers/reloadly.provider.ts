import { env } from "../../../core/config/env.js";
import type {
  AirtimePayload,
  DataPayload,
  ProviderResponse,
  TelecomProviderWithPlans,
} from "./provider.interface.js";

const DEFAULT_TIMEOUT_MS = 15_000;

const RELOADLY_AUTH_URL = "https://auth.reloadly.com/oauth/token";
const RELOADLY_TOPUPS_BASE =
  env.RELOADLY_ENV === "production"
    ? "https://topups.reloadly.com"
    : "https://topups-sandbox.reloadly.com";
const RELOADLY_TOPUPS_AUDIENCE =
  env.RELOADLY_ENV === "production"
    ? "https://topups.reloadly.com"
    : "https://topups-sandbox.reloadly.com";

let cachedToken: { token: string; expiresAt: number } | null = null;

async function fetchReloadlyAccessToken() {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 30_000 > now) {
    return cachedToken.token;
  }

  const body = {
    client_id: env.RELOADLY_API_CLIENT,
    client_secret: env.RELOADLY_API_SECRET,
    grant_type: "client_credentials",
    audience: RELOADLY_TOPUPS_AUDIENCE,
  };

  const res = await fetch(RELOADLY_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Reloadly auth failed: ${res.status} ${t}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
    token_type: string;
  };

  const expiresAt = now + (json.expires_in ?? 3600) * 1000;
  cachedToken = { token: json.access_token, expiresAt };
  return json.access_token;
}

async function reloadlyRequest<T>(input: {
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMs?: number;
}): Promise<T> {
  const token = await fetchReloadlyAccessToken();
  const url = new URL(input.path, RELOADLY_TOPUPS_BASE);

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const requestInit: RequestInit = {
      method: input.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        Accept: "application/com.reloadly.topups-v1+json",
      } as any,
      signal: controller.signal,
    };

    if (input.body !== undefined) requestInit.body = JSON.stringify(input.body);

    const resp = await fetch(url.toString(), requestInit);
    const text = await resp.text();
    const json = (text ? (JSON.parse(text) as T) : null) as T | null;

    if (!resp.ok) {
      throw new Error(
        `Reloadly request failed: ${resp.status} ${text?.slice(0, 200)}`,
      );
    }
    if (json === null) throw new Error("Reloadly returned empty response");
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

export const reloadlyProvider: TelecomProviderWithPlans = {
  async getNetworks() {
    // Fetch operators for CA and NG and combine
    const fetchByCountry = async (cc: string) => {
      const qs = new URLSearchParams({ size: String(200), countryCode: cc });
      const resp = await reloadlyRequest<any>({
        path: `/operators?${qs.toString()}`,
        method: "GET",
      });
      const content: any[] = Array.isArray((resp as any)?.content)
        ? (resp as any).content
        : Array.isArray(resp)
          ? (resp as any)
          : [];
      return content;
    };

    const [ca, ng] = await Promise.all([
      fetchByCountry("CA"),
      fetchByCountry("NG"),
    ]);
    const seen = new Set<string>();
    const combined = [...ca, ...ng].filter((op) => {
      const key = String(op.operatorId ?? op.id ?? op.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const networks = combined.map((op) => ({
      id: String(op.operatorId ?? op.id ?? op.name),
      name: String(op.name ?? op.operatorName ?? "Operator"),
      code: String(op.operatorId ?? op.id ?? op.name),
      country: op?.country?.isoName ?? "",
      logo: Array.isArray(op?.logoUrls) ? op.logoUrls[0] : undefined,
    }));

    return {
      airtimeNetworks: networks,
      dataNetworks: networks,
    };
  },

  async getDataPlans(_network: string) {
    const operatorId = Number(_network);
    if (!Number.isFinite(operatorId)) return { plans: [] } as any;
    const resp = await reloadlyRequest<any>({
      path: `/operators/${operatorId}`,
      method: "GET",
    });
    const fixed: number[] = Array.isArray(resp?.fixedAmounts)
      ? resp.fixedAmounts
      : [];
    const suggested: number[] = Array.isArray(resp?.suggestedAmounts)
      ? resp.suggestedAmounts
      : [];
    const amounts = fixed.length > 0 ? fixed : suggested;
    const plans = amounts.map((amt: number) => ({
      name: `${resp?.name ?? "Plan"} ${amt}`,
      amount: amt,
      plan_code: String(amt),
    }));
    return { plans } as any;
  },

  async purchaseAirtime(payload: AirtimePayload): Promise<ProviderResponse> {
    // For simplicity: autodetect operator by phone and country CA
    // Use GET /operators/mnp-lookup/phone/{phone}/countries/{countryCode}
    const phone = payload.mobileNumber;
    const detect = await reloadlyRequest<any>({
      path: `/operators/mnp-lookup/phone/${encodeURIComponent(
        phone,
      )}/countries/CA`,
      method: "GET",
    }).catch(() => null);

    const operatorId =
      detect?.operatorId ??
      detect?.id ??
      (Number(payload.network) || undefined);
    if (!operatorId) throw new Error("Unable to determine operator for phone");

    const body = {
      operatorId: Number(operatorId),
      amount: Number(payload.amount),
      recipientPhone: phone,
      customIdentifier: `airtime-${Date.now()}`,
    };

    const resp = await reloadlyRequest<any>({
      path: "/topups",
      method: "POST",
      body,
    });

    const status = String(resp?.status ?? "").toUpperCase();
    const providerReferenceVal = resp?.transactionId
      ? String(resp.transactionId)
      : undefined;
    const messageVal = (resp?.message ?? resp?.errorMessage) as
      | string
      | undefined;

    if (status === "SUCCESSFUL") {
      const result: ProviderResponse = {
        status: "SUCCESS",
        raw: resp,
        amount: String(resp?.requestedAmount ?? payload.amount),
      } as ProviderResponse;
      if (providerReferenceVal)
        (result as any).providerReference = providerReferenceVal;
      if (messageVal) (result as any).message = messageVal;
      return result;
    }

    if (status === "FAILED") {
      const result: ProviderResponse = {
        status: "FAILED",
        raw: resp,
      } as ProviderResponse;
      if (providerReferenceVal)
        (result as any).providerReference = providerReferenceVal;
      if (messageVal) (result as any).message = messageVal;
      return result;
    }

    const result: ProviderResponse = {
      status: "PENDING",
      raw: resp,
    } as ProviderResponse;
    if (providerReferenceVal)
      (result as any).providerReference = providerReferenceVal;
    if (messageVal) (result as any).message = messageVal;
    return result;
  },

  async purchaseData(payload: DataPayload): Promise<ProviderResponse> {
    const operatorId = Number(payload.network);
    const amount = Number(payload.planCode);
    if (!Number.isFinite(operatorId) || !Number.isFinite(amount)) {
      throw new Error("Invalid operator or amount for data purchase");
    }
    const body = {
      operatorId: Number(operatorId),
      amount: Number(amount),
      recipientPhone: payload.mobileNumber,
      customIdentifier: `data-${Date.now()}`,
    };
    const resp = await reloadlyRequest<any>({
      path: "/topups",
      method: "POST",
      body,
    });

    const status = String(resp?.status ?? "").toUpperCase();
    const providerReferenceVal = resp?.transactionId
      ? String(resp.transactionId)
      : undefined;
    const messageVal = (resp?.message ?? resp?.errorMessage) as
      | string
      | undefined;

    if (status === "SUCCESSFUL") {
      const result: ProviderResponse = {
        status: "SUCCESS",
        raw: resp,
        amount: String(resp?.requestedAmount ?? amount),
      } as ProviderResponse;
      if (providerReferenceVal)
        (result as any).providerReference = providerReferenceVal;
      if (messageVal) (result as any).message = messageVal;
      return result;
    }

    if (status === "FAILED") {
      const result: ProviderResponse = {
        status: "FAILED",
        raw: resp,
      } as ProviderResponse;
      if (providerReferenceVal)
        (result as any).providerReference = providerReferenceVal;
      if (messageVal) (result as any).message = messageVal;
      return result;
    }

    const result: ProviderResponse = {
      status: "PENDING",
      raw: resp,
    } as ProviderResponse;
    if (providerReferenceVal)
      (result as any).providerReference = providerReferenceVal;
    if (messageVal) (result as any).message = messageVal;
    return result;
  },
};
