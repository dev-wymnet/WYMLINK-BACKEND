import { resolve4 } from "node:dns/promises";
import { ProxyAgent, fetch, type RequestInit } from "undici";
import { eq, sql } from "drizzle-orm";

import { env } from "../../core/config/env.js";
import { db } from "../../core/db/client.js";
import { providerTokens } from "../../core/db/schema.js";
import { AppError } from "../../core/errors/AppError.js";
import { logger } from "../../core/logger/logger.js";

// Moneta only accepts whitelisted source IPs; route through the fixed-IP proxy when set.
//
// Pinning the good IP: Fixie picks the exit IP per tunnel (CONNECT), and counts a tunnel
// as one request however many HTTPS calls go through it. So all Moneta calls share ONE
// long-lived tunnel. A tunnel that exits from the IP Moneta doesn't whitelist is thrown
// away on the first rejection (dropTunnel) and a new one is opened; a tunnel that works
// is kept, so later calls leave from the whitelisted IP without spending more requests.
//
// Pinning the proxy server: the proxy host (e.g. ventoux.usefixie.com) is several entry
// servers, and each entry server always exits from the SAME public IP (checked 28 Oct:
// 52.215.137.118 → 54.217.142.99, 34.250.212.67 → 54.195.3.54). So tunnels are opened to
// one entry server by IP; when Moneta refuses its exit IP, the next entry server is tried
// and the one that works is kept. Every later call then leaves from the whitelisted IP.
const proxyUrl = env.MONETA_PROXY_URL || env.MONETA_PROXY;
const proxyBase = proxyUrl ? new URL(proxyUrl) : null;
const TUNNEL_KEEP_MS = 10 * 60_000;
const ENTRIES_TTL_MS = 60 * 60_000;
let entries: { hosts: string[]; at: number } | null = null;
let entryIndex = 0;

async function entryHosts(): Promise<string[]> {
  if (!proxyBase) return [];
  const host = proxyBase.hostname;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return [host];
  if (entries && Date.now() - entries.at < ENTRIES_TTL_MS) return entries.hosts;
  try {
    const hosts = (await resolve4(host)).sort();
    if (hosts.length) entries = { hosts, at: Date.now() };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "moneta_proxy_dns_failed");
  }
  return entries?.hosts ?? [host];
}

function agentFor(host: string | undefined) {
  if (!proxyBase || !host) return undefined;
  const u = new URL(proxyBase.toString());
  u.hostname = host;
  return new ProxyAgent({ uri: u.toString(), connections: 1, keepAliveTimeout: TUNNEL_KEEP_MS, keepAliveMaxTimeout: TUNNEL_KEEP_MS });
}

let dispatcher: ProxyAgent | undefined;
async function currentDispatcher() {
  if (!proxyBase) return undefined;
  if (!dispatcher) {
    const hosts = await entryHosts();
    dispatcher = agentFor(hosts[entryIndex % hosts.length]);
  }
  return dispatcher;
}

// `switchEntry`: the exit IP was refused, so move to the next entry server.
function dropTunnel(switchEntry = false) {
  if (switchEntry) {
    entryIndex++;
    logger.warn({ entryIndex }, "moneta_proxy_switch_entry");
  }
  const bad = dispatcher;
  dispatcher = undefined;
  // close(), not destroy(): requests already on the old tunnel finish instead of failing.
  void bad?.close().catch(() => undefined);
}


// An AppError, so the apps get its message (not a bare 500). 502, not 503: the apps
// read 503 as "this feature isn't live yet".
export class MonetaError extends AppError {
  constructor(message: string, readonly status: number, readonly body: unknown) {
    super(message, { statusCode: 502, code: "PROVIDER_UNAVAILABLE" });
    this.name = "MonetaError";
  }
}

const UNREACHABLE = "We couldn't reach the bank network. Please try again in a few minutes.";

export const recentNetworkErrors: Array<Record<string, unknown>> = [];

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
  const d = await currentDispatcher();
  try {
    res = await fetch(url, {
      ...rest,
      ...(d ? { dispatcher: d } : {}),
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
    // Kept for the deposit-tracing diagnostic; anything URL-like is cut so no credentials leak.
    const scrub = (v?: string) => v?.replace(/\w+:\/\/\S+/g, "<url>").slice(0, 200);
    if (recentNetworkErrors.push({ path: new URL(url).pathname, at: new Date().toISOString(), name: e.name, message: scrub(e.message), code: e.code ?? e.cause?.code, cause: scrub(e.cause?.message) }) > 10) recentNetworkErrors.shift();
    dropTunnel();
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
    dropTunnel(true); // this entry server exits from the wrong IP: move to the next one
    r = await fetchOnce(url, init);
  }
  if (isIpReject(r.json)) {
    if (recentNetworkErrors.push({ path: new URL(url).pathname, at: new Date().toISOString(), rejected: JSON.stringify(r.json).slice(0, 400) }) > 10) recentNetworkErrors.shift();
    dropTunnel();
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

// Deposit-tracing diagnostic: each proxy entry server, the public IP it leaves from, and
// which one Moneta calls currently use.
export async function proxyExitIps() {
  const hosts = await entryHosts();
  const servers: Array<{ entry: string; exitIp: string; inUse: boolean }> = [];
  for (const [i, host] of hosts.entries()) {
    const d = agentFor(host);
    try {
      const r = await fetch("https://api.ipify.org", { ...(d ? { dispatcher: d } : {}), signal: AbortSignal.timeout(15_000) } as RequestInit);
      servers.push({ entry: host, exitIp: (await r.text()).slice(0, 60), inUse: hosts.length > 0 && i === entryIndex % hosts.length });
    } catch (e) {
      servers.push({ entry: host, exitIp: "error: " + String((e as Error).message).slice(0, 80), inUse: i === entryIndex % hosts.length });
    } finally {
      void d?.close().catch(() => undefined);
    }
  }
  return { proxyConfigured: Boolean(proxyUrl), servers };
}
