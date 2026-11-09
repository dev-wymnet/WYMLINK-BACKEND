import type { RequestHandler } from "express";
import { isIP } from "net";
import { timingSafeEqual } from "crypto";

import { config } from "../config/index.js";

// The web app calls this API from its own server (BFF), so the TCP peer is the
// web server, not the customer. When the BFF proves itself with the shared
// secret, trust the client IP it reports; otherwise keep Express's req.ip
// (derived from TRUST_PROXY_HOPS). Everything downstream — rate limiters,
// audit logs, geolocation — then sees the real client.
//
// On Render, requests pass Cloudflare, Render's balancer and a local proxy, so req.ip is
// often an internal address (10.x, ::1) shared by every customer. Cloudflare sets
// CF-Connecting-IP to the address that connected to it (it overwrites any value a client
// sends), so when req.ip is internal, that header is the customer's real address.

const secret = config.BFF_SHARED_SECRET ? Buffer.from(config.BFF_SHARED_SECRET) : null;

const secretMatches = (provided: string | undefined) => {
  if (!secret || !provided) return false;
  const p = Buffer.from(provided);
  return p.length === secret.length && timingSafeEqual(p, secret);
};

// Loopback, private (RFC 1918), CGNAT-internal, link-local and IPv6 local addresses.
const internal = (ip: string | undefined) => {
  if (!ip) return true;
  const v4 = ip.replace(/^::ffff:/i, "");
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number) as [number, number];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = ip.toLowerCase();
  return v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
};

const setIp = (req: Parameters<RequestHandler>[0], ip: string) => Object.defineProperty(req, "ip", { value: ip, configurable: true, enumerable: true });

export const clientIp: RequestHandler = (req, _res, next) => {
  const reported = req.get("x-wl-client-ip")?.trim();
  if (reported && isIP(reported) && secretMatches(req.get("x-wl-bff-secret"))) {
    setIp(req, reported);
  } else if (internal(req.ip)) {
    const cf = req.get("cf-connecting-ip")?.trim();
    if (cf && isIP(cf)) setIp(req, cf);
  }
  next();
};
