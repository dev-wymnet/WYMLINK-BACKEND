import { env } from "../../core/config/env.js";
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

// Moneta NIBSS BVN service (api.moneta.ng/api/v2). Same API Etico uses.
const PROVIDER = "moneta_bvn";

export const monetaBvnConfigured = () =>
  Boolean(env.MONETA_BVN_CLIENT_ID && env.MONETA_BVN_CLIENT_SECRET && env.MONETA_BVN_SERVICE_KEY);

async function mint() {
  const creds = Buffer.from(
    `${env.MONETA_BVN_CLIENT_ID}:${env.MONETA_BVN_CLIENT_SECRET}:${env.MONETA_BVN_SERVICE_KEY}`,
  ).toString("base64");
  const r = await monetaFetch(`${env.MONETA_API_URL}/api/v2/generate-access-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Auth-Token": creds },
    timeoutMs: 30_000,
  });
  if (!isMonetaSuccess(r.json?.status) || typeof r.json?.data !== "string") {
    throw new MonetaError("BVN service unavailable. Please try again shortly.", r.status, null);
  }
  return { token: r.json.data as string, expiresAt: null };
}

async function post(path: string, body: object): Promise<MonetaResponse> {
  let token = await sharedToken(PROVIDER, mint);
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await monetaFetch(`${env.MONETA_API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-Service-Token": token },
      body: JSON.stringify(body),
    });
    if (attempt === 0 && looksLikeTokenRejection(r)) {
      forgetToken(PROVIDER, token);
      token = await sharedToken(PROVIDER, mint, token);
      continue;
    }
    // Never log the BVN or identity data: shape and status only.
    logger.info({ path, http: r.status, ok: isMonetaSuccess(r.json?.status) }, "moneta_bvn_call");
    return r;
  }
  throw new MonetaError("BVN service unavailable. Please try again shortly.", 503, null);
}

// BVN ↔ bank account ownership check (no OTP). `institutionCode` is the
// 6-digit NIBSS institution code of the bank.
export async function bvnAccountIdentityCheck(input: {
  bvn: string;
  accountNumber: string;
  institutionCode: string;
  firstName: string;
  lastName: string;
}) {
  const r = await post("/api/v2/bvn/account_identity_check", {
    bvn: input.bvn,
    account_number: input.accountNumber,
    institution_code: input.institutionCode,
    first_name: input.firstName,
    last_name: input.lastName,
  });
  const d = (r.json?.data ?? {}) as Record<string, unknown>;
  return {
    ok: r.status >= 200 && r.status < 300 && isMonetaSuccess(r.json?.status),
    bvnMatch: d.bvn_match === true,
    nameMatchPercentage: Number(d.name_match_percentage ?? 0),
    accountName: typeof d.account_name === "string" ? d.account_name : null,
    reference: typeof d.reference === "string" ? d.reference : null,
    message: typeof r.json?.message === "string" ? r.json.message : null,
  };
}
