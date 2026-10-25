import jwt from "jsonwebtoken";

import { env } from "../config/env.js";
import { config } from "../config/index.js";

export type AccessTokenPayload = {
  sub: string;
  role: string;
};

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, config.JWT_SECRET ?? env.JWT_ACCESS_SECRET, {
    algorithm: "HS256",
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, config.JWT_SECRET ?? env.JWT_ACCESS_SECRET, {
    algorithms: ["HS256"],
  }) as AccessTokenPayload;
}
