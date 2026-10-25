import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";

import { UnauthorizedError } from "../errors/UnauthorizedError.js";
import { AccountInactiveError } from "../errors/AppError.js";
import { verifyAccessToken } from "../auth/jwt.js";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";

type AuthUser = { id: string; role: string };

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
    rawBody?: Buffer;
  }
}

// A suspended/disabled account must stop working at once, not when its access
// token expires. Status is cached per instance for a short time so this costs
// at most one small query per user per STATUS_TTL_MS.
const STATUS_TTL_MS = 30_000;
const statusCache = new Map<string, { status: string | null; at: number }>();

async function userStatus(userId: string): Promise<string | null> {
  const hit = statusCache.get(userId);
  if (hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.status;
  const rows = await db.select({ status: users.status }).from(users).where(eq(users.id, userId)).limit(1);
  const status = rows[0] ? ((rows[0].status as string | null) ?? "active") : null;
  statusCache.set(userId, { status, at: Date.now() });
  if (statusCache.size > 50_000) statusCache.clear();
  return status;
}

/** Call after changing a user's status so this instance stops honouring it immediately. */
export const forgetUserStatus = (userId: string) => statusCache.delete(userId);

export const authGuard: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header) return next(new UnauthorizedError("Missing Authorization header"));

  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return next(new UnauthorizedError("Invalid Authorization header"));

  let payload: { sub: string; role: string };
  try {
    payload = verifyAccessToken(token);
  } catch {
    return next(new UnauthorizedError("Invalid or expired access token"));
  }

  try {
    const status = await userStatus(payload.sub);
    if (status === null) return next(new UnauthorizedError("Invalid or expired access token"));
    if (status !== "active") return next(new AccountInactiveError());
  } catch (err) {
    return next(err);
  }

  req.user = { id: payload.sub, role: payload.role };
  return next();
};
