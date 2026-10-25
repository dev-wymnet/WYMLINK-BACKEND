import { env } from "../../../core/config/env.js";

import type {
  AirtimePayload,
  DataPayload,
  ProviderResponse,
  TelecomProviderWithPlans,
} from "./provider.interface.js";

const DEFAULT_TIMEOUT_MS = 15_000;

async function peyflexRequest<T>(input: {
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
  auth?: boolean;
  timeoutMs?: number;
}): Promise<T> {
  const url = new URL(input.path, env.PEYFLEX_BASE_URL);

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (input.auth !== false) {
    headers.Authorization = `Token ${env.PEYFLEX_API_TOKEN}`;
  }

  try {
    const requestInit: RequestInit = {
      method: input.method ?? "GET",
      headers,
      signal: controller.signal,
    };

    if (input.body !== undefined) {
      requestInit.body = JSON.stringify(input.body);
    }

    const resp = await fetch(url.toString(), requestInit);

    const json = (await resp.json().catch(() => null)) as T | null;

    if (!resp.ok) {
      throw new Error(
        `Peyflex request failed: ${resp.status} ${JSON.stringify(json)}`,
      );
    }

    if (json === null) throw new Error("Peyflex returned empty response");

    return json;
  } finally {
    clearTimeout(timeout);
  }
}

export const peyflexProvider: TelecomProviderWithPlans = {
  async getNetworks() {
    const [airtime, data] = await Promise.all([
      peyflexRequest<any>({
        path: "/api/airtime/networks/",
        method: "GET",
        auth: true,
      }),
      peyflexRequest<any>({
        path: "/api/data/networks/",
        method: "GET",
        auth: true,
      }),
    ]);

    return {
      airtimeNetworks: airtime?.networks ?? airtime,
      dataNetworks: data?.networks ?? data,
    };
  },

  async getDataPlans(network: string) {
    const qs = new URLSearchParams({ network });
    return peyflexRequest<any>({
      path: `/api/data/plans/?${qs.toString()}`,
      method: "GET",
      auth: false,
    });
  },

  async purchaseAirtime(payload: AirtimePayload): Promise<ProviderResponse> {
    const resp = await peyflexRequest<any>({
      path: "/api/airtime/topup/",
      method: "POST",
      body: {
        network: payload.network,
        amount: payload.amount,
        mobile_number: payload.mobileNumber,
      },
      auth: true,
    });

    const status = String(resp?.status ?? "").toUpperCase();

    const providerReference = resp?.reference
      ? String(resp.reference)
      : undefined;
    const message = resp?.message ? String(resp.message) : undefined;
    const amount = resp?.amount ? String(resp.amount) : undefined;

    if (status === "SUCCESS") {
      const result: ProviderResponse = { status: "SUCCESS", raw: resp };
      if (providerReference) result.providerReference = providerReference;
      if (message) result.message = message;
      if (amount) result.amount = amount;
      return result;
    }

    if (status === "FAILED") {
      const result: ProviderResponse = { status: "FAILED", raw: resp };
      if (providerReference) result.providerReference = providerReference;
      if (message) result.message = message;
      if (amount) result.amount = amount;
      return result;
    }

    const result: ProviderResponse = { status: "PENDING", raw: resp };
    if (providerReference) result.providerReference = providerReference;
    if (message) result.message = message;
    if (amount) result.amount = amount;
    return result;
  },

  async purchaseData(payload: DataPayload): Promise<ProviderResponse> {
    const resp = await peyflexRequest<any>({
      path: "/api/data/purchase/",
      method: "POST",
      body: {
        network: payload.network,
        mobile_number: payload.mobileNumber,
        plan_code: payload.planCode,
      },
      auth: true,
    });

    const status = String(resp?.status ?? "").toUpperCase();

    const providerReference = resp?.reference
      ? String(resp.reference)
      : undefined;
    const message = resp?.message ? String(resp.message) : undefined;
    const amount = resp?.amount ? String(resp.amount) : undefined;

    if (status === "SUCCESS") {
      const result: ProviderResponse = { status: "SUCCESS", raw: resp };
      if (providerReference) result.providerReference = providerReference;
      if (message) result.message = message;
      if (amount) result.amount = amount;
      return result;
    }

    if (status === "FAILED") {
      const result: ProviderResponse = { status: "FAILED", raw: resp };
      if (providerReference) result.providerReference = providerReference;
      if (message) result.message = message;
      if (amount) result.amount = amount;
      return result;
    }

    const result: ProviderResponse = { status: "PENDING", raw: resp };
    if (providerReference) result.providerReference = providerReference;
    if (message) result.message = message;
    if (amount) result.amount = amount;
    return result;
  },
};
