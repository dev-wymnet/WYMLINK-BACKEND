import { createHash } from "node:crypto";
import type { Request, RequestHandler } from "express";
import rateLimit from "express-rate-limit";

// Every limiter answers in the API's normal error shape, so apps can show it.
const tooMany = {
  success: false,
  error: { code: "RATE_LIMITED", message: "Too many attempts. Please wait a moment and try again." },
};

const identity = (req: Request) => String(req.body?.email || req.body?.phone || "").trim().toLowerCase();

// The session id prefix of a refresh token ("<sessionId>.<secret>").
const refreshSession = (req: Request) => String(req.body?.refreshToken ?? "").split(".")[0]?.slice(0, 64) ?? "";

// Nigerian mobile networks put many customers behind one carrier IP (CGNAT), so
// per-IP limits only suit anonymous traffic; signed-in routes limit per user.
export function limiter(input: {
  windowMs: number;
  max: number;
  // ip (default) | user (signed-in user, else ip) | ip+identity (ip and the email/phone tried)
  // | session (the refresh token's session, else ip) | bearer (the access token sent, else ip)
  by?: "ip" | "user" | "ip+identity" | "session" | "bearer";
  // Count only refused requests (status >= 400), e.g. wrong passwords.
  failuresOnly?: boolean;
}) {
  const by = input.by ?? "ip";
  return rateLimit({
    windowMs: input.windowMs,
    max: input.max,
    skipSuccessfulRequests: input.failuresOnly ?? false,
    standardHeaders: true,
    legacyHeaders: false,
    message: tooMany,
    keyGenerator: (req) => {
      const ip = req.ip ?? "anon";
      if (by === "user") return (req as any).user?.id ?? ip;
      if (by === "ip+identity") return `${ip}:${identity(req)}`;
      if (by === "session") return refreshSession(req) ? `session:${refreshSession(req)}` : ip;
      if (by === "bearer") {
        const auth = req.get("authorization");
        return auth ? `bearer:${createHash("sha256").update(auth).digest("hex").slice(0, 32)}` : ip;
      }
      return ip;
    },
  });
}

// The API-wide limit. Anonymous requests (sign-up, sign-in, QR lookups): `max` ×
// `anonymousFactor` per IP; each of those routes also has its own, stricter limits.
// Signed-in requests (they carry an access token): `max` per token, plus a per-IP ceiling
// `venueFactor` times higher, since a conference Wi-Fi or a carrier's CGNAT puts hundreds of
// customers on one IP. The token is not verified here (authGuard does that), so the IP
// ceiling still bounds made-up tokens.
export function apiLimiter(input: { windowMs: number; max: number; anonymousFactor: number; venueFactor: number }): RequestHandler {
  const anonymous = limiter({ windowMs: input.windowMs, max: input.max * input.anonymousFactor });
  const perToken = limiter({ windowMs: input.windowMs, max: input.max, by: "bearer" });
  const perIp = limiter({ windowMs: input.windowMs, max: input.max * input.venueFactor });
  return (req, res, next) => {
    if (!req.get("authorization")) return anonymous(req, res, next);
    perToken(req, res, (err?: unknown) => (err ? next(err) : perIp(req, res, next)));
  };
}
