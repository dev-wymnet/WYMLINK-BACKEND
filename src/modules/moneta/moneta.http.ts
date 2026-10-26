import { ProxyAgent, fetch, type RequestInit } from "undici";
import { eq, sql } from "drizzle-orm";

import { env } from "../../core/config/env.js";
import { db } from "../../core/db/client.js";
import { providerTokens } from "../../core/db/schema.js";
import { AppError } from "../../core/errors/AppError.js";
import { logger } from "../../core/logger/logger.js";

// Moneta only accepts whitelisted source IPs; route through the fixed-IP proxy when set.
const proxyUrl = env.MONETA_PROXY_URL || env.MONETA_PROXY;
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

// An AppError, so the apps get its message (not a bare 500). 502, not 503: the apps
// read 503 as "this feature isn't live yet".
export class MonetaError extends AppError {
  constructor(message: string, readonly status: number, readonly body: unknown) {
    super(message, { statusCode: 502, code: "PROVIDER_UNAVAILABLE" });
    this.name = "MonetaError";
  }
}

const UNREACHABLE = "We couldn't reach the bank network. Please try again in a few minutes.";

export type MonetaResponse = { status: number; json: any };

// The proxy (Fixie) load-balances across two static IPs, but Moneta whitelists
// only ONE of them for WymNet. A request that leaves from the other IP is rejected with
// "IP address not recognized" or "Ip address not whitelisted" (responseErrorCode 03)
// before Moneta processes it, so re-sending it is safe, even for payouts, until it
// leaves from the right IP. The wording and the field it sits in vary by endpoint.
const IP_RETRIES = 8;
const isIpReject = (json: any) =>
  json?.responseErrorCode === "03" ||
  /\bip\b[^"]{0,20}not\s*(whitelist|recogni[sz]ed)|not\s*whitelist/i.test(JSON.stringify(json ?? "").slice(0, 400));

async function fetchOnce(url: string, init: RequestInit & { timeoutMs?: number }): Promise<MonetaResponse> {
  const { timeoutMs: _t, ...rest } = init;
  let res: Awaited<ReturnType<typeof fetch>>;
  let text: string;
  try {
    res = await fetch(url, {
      ...rest,
      ...(dispatcher ? { dispatcher } : {}),
      signal: AbortSignal.timeout(init.timeoutMs ?? 45_000),
    });
    text = await res.text();
  } catch (err) {
    // The proxy refused the tunnel (e.g. Fixie's monthly quota used up: "Proxy response
    // (407|403) !== 200"), a timeout, or a network failure. Message and code only: the
    // error object can carry the proxy URL, which holds its credentials.
    const e = err as Error & { code?: string; cause?: { code?: string; message?: string } };
    logger.error(
      { path: new URL(url).pathname, name: e.name, message: e.message?.slice(0, 200), code: e.code ?? e.cause?.code, cause: e.cause?.message?.slice(0, 200) },
      /proxy/i.test(`${e.message} ${e.cause?.message}`) ? "moneta_proxy_refused" : "moneta_unreachable",
    );
    throw new MonetaError(UNREACHABLE, 502, null);
  }
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    // e.g. a proxy's quota page or an HTML gateway error.
    return { status: res.status, json: { status: false, message: `Unexpected response (${res.status})` } };
  }
}

export async function monetaFetch(url: string, init: RequestInit & { timeoutMs?: number }): Promise<MonetaResponse> {
  let r = await fetchOnce(url, init);
  for (let i = 1; i < IP_RETRIES && isIpReject(r.json); i++) {
    logger.info({ attempt: i }, "moneta_ip_not_whitelisted_retry");
    r = await fetchOnce(url, init);
  }
  if (isIpReject(r.json)) {
    throw new MonetaError("Moneta is temporarily unreachable. Please try again shortly.", 503, null);
  }
  return r;
}

export const isMonetaSuccess = (v: unknown) => v === true || v === "success" || v === "true";

// Moneta keeps only ONE live token per credential set: a new mint invalidates
// the others. Every instance shares the token in app.provider_tokens, and only
// the instance holding the row lock mints.
const LOCK_SECONDS = 30;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const local = new Map<string, string>();

async function readShared(provider: string) {
  const rows = await db.select().from(providerTokens).where(eq(providerTokens.provider, provider)).limit(1);
  const row = rows[0];
  if (!row?.token) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now() + 30_000) return null;
  return row.token;
}

async function tryLock(provider: string) {
  const res = await db.execute(sql`
    insert into app.provider_tokens (provider, token, lock_until)
    values (${provider}, '', now() + make_interval(secs => ${LOCK_SECONDS}))
    on conflict (provider) do update set lock_until = excluded.lock_until
      where app.provider_tokens.lock_until is null or app.provider_tokens.lock_until < now()
    returning provider`);
  return res.rows.length === 1;
}

async function storeShared(provider: string, token: string | null, expiresAt: Date | null) {
  await db
    .update(providerTokens)
    .set(token ? { token, expiresAt, mintedAt: new Date(), lockUntil: null } : { lockUntil: null })
    .where(eq(providerTokens.provider, provider));
}

// Returns a usable token, never `rejected` (one Moneta just refused).
export async function sharedToken(
  provider: string,
  mint: () => Promise<{ token: string; expiresAt: Date | null }>,
  rejected?: string,
): Promise<string> {
  const mine = local.get(provider);
  if (mine && mine !== rejected) return mine;

  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const shared = await readShared(provider);
    if (shared && shared !== rejected) {
      local.set(provider, shared);
      return shared;
    }
    if (await tryLock(provider)) {
      try {
        const again = await readShared(provider);
        if (again && again !== rejected) {
          await storeShared(provider, null, null);
          local.set(provider, again);
          return again;
        }
        const { token, expiresAt } = await mint();
        await storeShared(provider, token, expiresAt);
        local.set(provider, token);
        logger.info({ provider }, "moneta_token_minted");
        return token;
      } catch (err) {
        await storeShared(provider, null, null).catch(() => undefined);
        throw err;
      }
    }
    await sleep(1000);
  }
  throw new MonetaError("Moneta is busy. Please try again shortly.", 503, null);
}

export function forgetToken(provider: string, token: string) {
  if (local.get(provider) === token) local.delete(provider);
}

// Moneta answers an expired token with an ordinary error body, not always a 401.
export const looksLikeTokenRejection = (r: MonetaResponse) =>
  r.status === 401 ||
  /unauthori[sz]ed|invalid[^"]{0,20}token|token[^"]{0,20}(expired|invalid)|expired[^"]{0,20}token/i.test(
    JSON.stringify(r.json ?? "").slice(0, 400),
  );
