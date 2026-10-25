import { env } from "../../../core/config/env.js";

type MonnifyLoginResponse = {
  requestSuccessful?: boolean;
  responseBody?: {
    accessToken: string;
    expiresIn: number;
  };
};

type MonnifyApiResponse<T> = {
  requestSuccessful?: boolean;
  responseBody?: T;
};

export type MonnifyVerifiedTransaction = {
  transactionReference: string;
  paymentReference?: string;
  amountPaid?: string;
  totalPayable?: string;
  paymentStatus?: "PAID" | "FAILED" | "PENDING" | "EXPIRED" | string;
};

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

function basicAuthHeader(apiKey: string, secretKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:${secretKey}`).toString("base64")}`;
}

// Simple fetch timeout helper to fail fast in development
function withTimeout(ms: number) {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);
    const req: RequestInit = { ...(init || {}), signal: controller.signal };
    return fetch(input as any, req).finally(() => clearTimeout(id));
  };
}

const fetchWithTimeout = withTimeout(12_000);

export async function monnifyGetAccessToken(): Promise<string> {
  const now = Date.now();

  if (cachedToken && now < tokenExpiresAt) {
    return cachedToken;
  }

  const url = new URL("/api/v1/auth/login", env.MONNIFY_BASE_URL);

  const resp = await fetchWithTimeout(url.toString(), {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(
        env.MONNIFY_API_KEY,
        env.MONNIFY_SECRET_KEY,
      ),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (!resp.ok) {
    throw new Error(`Monnify auth failed: ${resp.status} ${await resp.text()}`);
  }

  const data = (await resp.json()) as MonnifyLoginResponse;

  const accessToken = data.responseBody?.accessToken;
  const expiresIn = data.responseBody?.expiresIn;

  if (!accessToken || !expiresIn) {
    throw new Error("Monnify auth: missing token");
  }

  cachedToken = accessToken;

  // refresh one minute before expiry
  tokenExpiresAt = Date.now() + (expiresIn - 60) * 1000;

  return accessToken;
}

async function monnifyAuthedRequest<T>(input: {
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
}): Promise<MonnifyApiResponse<T>> {
  const token = await monnifyGetAccessToken();

  const url = new URL(input.path, env.MONNIFY_BASE_URL);

  const request: RequestInit = {
    method: input.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };

  if (input.body !== undefined) {
    request.body = JSON.stringify(input.body);
  }

  const resp = await fetchWithTimeout(url.toString(), request);

  const json = (await resp
    .json()
    .catch(() => null)) as MonnifyApiResponse<T> | null;

  if (!resp.ok) {
    throw new Error(
      `Monnify request failed: ${resp.status} ${JSON.stringify(json)}`,
    );
  }

  if (!json?.requestSuccessful) {
    throw new Error(`Monnify request unsuccessful: ${JSON.stringify(json)}`);
  }

  return json;
}

export type MonnifyBank = {
  name?: string;
  code?: string;
  ussdTemplate?: string | null;
  baseUssdCode?: string | null;
  transferUssdTemplate?: string | null;
};

export async function monnifyGetBanks() {
  const resp = await monnifyAuthedRequest<MonnifyBank[]>({
    path: "/api/v1/banks",
    method: "GET",
  });
  return resp.responseBody ?? [];
}

export async function monnifyCreateReservedAccount(payload: {
  accountReference: string;
  accountName: string;
  currencyCode: string;
  contractCode: string;
  customerEmail: string;
  bvn?: string;
  getAllAvailableBanks: boolean;
}) {
  return monnifyAuthedRequest<{
    accountReference?: string;
    reservationReference?: string;
    status?: string;
    accounts?: Array<{
      accountNumber?: string;
      bankCode?: string;
      bankName?: string;
      accountName?: string;
    }>;
  }>({
    path: "/api/v2/bank-transfer/reserved-accounts",
    method: "POST",
    body: payload,
  });
}

export async function monnifyVerifyTransaction(transactionReference: string) {
  const resp = await monnifyAuthedRequest<MonnifyVerifiedTransaction>({
    path: `/api/v2/transactions/${encodeURIComponent(transactionReference)}`,
    method: "GET",
  });

  return resp.responseBody ?? null;
}

export async function monnifyCreateSingleDisbursement(payload: {
  amount: number;
  reference: string;
  narration: string;
  destinationBankCode: string;
  destinationAccountNumber: string;
  destinationAccountName: string;
  currency: string;
  sourceAccountNumber: string;
  async?: boolean;
}) {
  return monnifyAuthedRequest<any>({
    path: "/api/v2/disbursements/single",
    method: "POST",
    body: payload,
  });
}

export async function monnifyGetSingleDisbursementSummary(reference: string) {
  return monnifyAuthedRequest<any>({
    path: `/api/v2/disbursements/single/summary?reference=${encodeURIComponent(
      reference,
    )}`,
    method: "GET",
  });
}

export async function monnifyValidateDisbursementOtp(payload: {
  reference: string;
  authorizationCode: string;
}) {
  return monnifyAuthedRequest<any>({
    path: "/api/v2/disbursements/single/validate-otp",
    method: "POST",
    body: payload,
  });
}

export async function monnifyResendDisbursementOtp(payload: {
  reference: string;
}) {
  return monnifyAuthedRequest<any>({
    path: "/api/v2/disbursements/single/resend-otp",
    method: "POST",
    body: payload,
  });
}

export async function monnifyGetWalletBalance(accountNumber: string) {
  return monnifyAuthedRequest<any>({
    path: `/api/v2/disbursements/wallet-balance?accountNumber=${encodeURIComponent(
      accountNumber,
    )}`,
    method: "GET",
  });
}

export async function monnifyBvnAccountMatch(payload: {
  bvn: string;
  bankCode: string;
  accountNumber: string;
  name: string;
}) {
  return monnifyAuthedRequest<{
    bvn?: string;
    accountNumber?: string;
    bankCode?: string;
    accountName?: string;
    bvnAccountNameMatch?: boolean;
  }>({
    path: "/api/v1/vas/bvn-account-match",
    method: "POST",
    body: payload,
  });
}

export async function monnifyNinVerification(payload: { nin: string }) {
  return monnifyAuthedRequest<{
    nin?: string;
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string;
    gender?: string;
    phoneNumber?: string;
  }>({
    path: "/api/v1/vas/nin-verification",
    method: "POST",
    body: payload,
  });
}

export async function monnifyNameEnquiry(input: {
  accountNumber: string;
  bankCode: string;
}) {
  const token = await monnifyGetAccessToken();
  const url = new URL(
    "/api/v2/disbursements/account/validate",
    env.MONNIFY_BASE_URL,
  );
  url.searchParams.set("accountNumber", input.accountNumber);
  url.searchParams.set("bankCode", input.bankCode);

  const resp = await fetchWithTimeout(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  const json = (await resp.json().catch(() => null)) as MonnifyApiResponse<{
    accountNumber?: string;
    accountName?: string;
    bankCode?: string;
    bankName?: string;
  }> | null;

  if (!resp.ok || !json?.requestSuccessful) {
    throw new Error(
      `Monnify name enquiry failed: ${resp.status} ${JSON.stringify(json)}`,
    );
  }

  return json.responseBody ?? null;
}

export async function monnifySearchTransactions(
  query: Record<string, string | number | undefined>,
) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && `${value}`.length > 0) {
      params.set(key, String(value));
    }
  }

  const path =
    params.size > 0
      ? `/api/v1/transactions/search?${params.toString()}`
      : "/api/v1/transactions/search";

  const resp = await monnifyAuthedRequest({
    path,
    method: "GET",
  });

  return resp.responseBody ?? null;
}
