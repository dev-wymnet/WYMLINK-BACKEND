import jwt from "jsonwebtoken";

import { env } from "../config/env.js";
import { config } from "../config/index.js";

// sid: the session the token was issued for. The auth guard checks that session on
// every request, so signing out or revoking a session stops its token at once.
export type AccessTokenPayload = {
  sub: string;
  role: string;
  sid: string;
};

export function signAccessToken(payload: AccessTokenPayload, ttlSeconds: number = env.JWT_ACCESS_TTL_SECONDS): string {
  return jwt.sign(payload, config.JWT_SECRET ?? env.JWT_ACCESS_SECRET, {
    algorithm: "HS256",
    expiresIn: ttlSeconds,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const payload = jwt.verify(token, config.JWT_SECRET ?? env.JWT_ACCESS_SECRET, {
    algorithms: ["HS256"],
  }) as Partial<AccessTokenPayload>;
  // Tokens from before sessions were checked carry no sid: refused, so the app refreshes.
  if (typeof payload.sub !== "string" || typeof payload.sid !== "string") throw new Error("token_claims");
  return payload as AccessTokenPayload;
}
