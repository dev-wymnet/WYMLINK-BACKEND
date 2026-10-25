import type { RequestHandler } from "express";
import { isIP } from "net";
import { timingSafeEqual } from "crypto";

import { config } from "../config/index.js";

// The web app calls this API from its own server (BFF), so the TCP peer is the
// web server, not the customer. When the BFF proves itself with the shared
// secret, trust the client IP it reports; otherwise keep Express's req.ip
// (derived from TRUST_PROXY_HOPS). Everything downstream — rate limiters,
// audit logs, geolocation — then sees the real client.

const secret = config.BFF_SHARED_SECRET ? Buffer.from(config.BFF_SHARED_SECRET) : null;

const secretMatches = (provided: string | undefined) => {
  if (!secret || !provided) return false;
  const p = Buffer.from(provided);
  return p.length === secret.length && timingSafeEqual(p, secret);
};

export const clientIp: RequestHandler = (req, _res, next) => {
  const reported = req.get("x-wl-client-ip")?.trim();
  if (reported && isIP(reported) && secretMatches(req.get("x-wl-bff-secret"))) {
    Object.defineProperty(req, "ip", { value: reported, configurable: true, enumerable: true });
  }
  next();
};
