import type { RequestHandler } from "express";

import { UnauthorizedError } from "../errors/UnauthorizedError.js";
import { AccountInactiveError } from "../errors/AppError.js";
import { verifyAccessToken, type AccessTokenPayload } from "../auth/jwt.js";
import { forgetUserSessions, noteAdminActivity, sessionState } from "../auth/sessionState.js";

type AuthUser = { id: string; role: string; sessionId: string; sessionKind: string };

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
    rawBody?: Buffer;
  }
}

/** Call after changing a user's status so this instance stops honouring it immediately. */
export const forgetUserStatus = (userId: string) => forgetUserSessions(userId);

// The same answer for every dead token, so the apps refresh (and, if the session is
// gone, sign out) the way they do when a token simply expires.
const deadToken = () => new UnauthorizedError("Invalid or expired access token");

// Every request checks the session behind its token (cached briefly, see sessionState):
// a signed-out, revoked or expired session, or a suspended account, stops working at
// once instead of when the access token runs out. The role comes from the database.
export const authGuard: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header) return next(new UnauthorizedError("Missing Authorization header"));

  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return next(new UnauthorizedError("Invalid Authorization header"));

  let payload: AccessTokenPayload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return next(deadToken());
  }

  try {
    const s = await sessionState(payload.sid);
    if (!s || s.userId !== payload.sub || s.revoked || s.expiresAt <= Date.now()) return next(deadToken());
    if (s.userStatus !== "active") return next(new AccountInactiveError());
    if (s.kind === "admin" && !(await noteAdminActivity(payload.sid, s))) return next(deadToken());
    req.user = { id: payload.sub, role: s.role, sessionId: payload.sid, sessionKind: s.kind };
    return next();
  } catch (err) {
    return next(err);
  }
};
