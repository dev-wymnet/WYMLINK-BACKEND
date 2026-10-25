import { env } from "../../../core/config/env.js";

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

export const peyflexBillsProvider = {
  // Cable TV
  async listCableProviders() {
    return peyflexRequest<any>({ path: "/api/cable/providers/", method: "GET", auth: false });
  },
  async listCablePlans(identifier: string) {
    return peyflexRequest<any>({
      path: `/api/cable/plans/${encodeURIComponent(identifier)}/`,
      method: "GET",
      auth: false,
    });
  },
  async verifyCableIuc(input: { iuc: string; identifier: string }) {
    return peyflexRequest<any>({
      path: "/api/cable/verify/",
      method: "POST",
      body: { iuc: input.iuc, identifier: input.identifier },
      auth: true,
    });
  },
  async subscribeCable(input: {
    identifier: string;
    plan: string;
    iuc: string;
    phone: string;
    amount?: number | string;
  }) {
    const body: Record<string, any> = {
      identifier: input.identifier,
      plan: input.plan,
      iuc: input.iuc,
      phone: input.phone,
    };
    if (input.amount !== undefined) body.amount = String(input.amount);
    return peyflexRequest<any>({
      path: "/api/cable/subscribe/",
      method: "POST",
      body,
      auth: true,
    });
  },

  // Electricity
  async listElectricityPlans() {
    const qs = new URLSearchParams({ identifier: "electricity" });
    return peyflexRequest<any>({
      path: `/api/electricity/plans/?${qs.toString()}`,
      method: "GET",
      auth: false,
    });
  },
  async verifyElectricity(input: {
    meter: string;
    plan: string;
    type: string; // prepaid|postpaid
  }) {
    const qs = new URLSearchParams({
      identifier: "electricity",
      meter: input.meter,
      plan: input.plan,
      type: input.type,
    });
    return peyflexRequest<any>({
      path: `/api/electricity/verify/?${qs.toString()}`,
      method: "GET",
      auth: false,
    });
  },
  async subscribeElectricity(input: {
    meter: string;
    plan: string;
    amount: number | string;
    type: string; // prepaid|postpaid
    phone: string;
  }) {
    const body = {
      identifier: "electricity",
      meter: input.meter,
      plan: input.plan,
      amount: String(input.amount),
      type: input.type,
      phone: input.phone,
    };
    return peyflexRequest<any>({
      path: "/api/electricity/subscribe/",
      method: "POST",
      body,
      auth: true,
    });
  },
};
