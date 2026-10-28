import { and, eq, isNull } from "drizzle-orm";

import { db } from "../db/client.js";
import { sessions, users } from "../db/schema.js";

// The session behind an access token, as the auth guard needs it. Cached per instance
// for a few seconds, so a check costs at most one small query per session per CACHE_MS.
// Revoking a session (or changing a user's status) clears its entry, so on this instance
// it takes effect at once; other instances follow within CACHE_MS.
const CACHE_MS = 15_000;

// Staff sessions end after this long without a request.
export const ADMIN_IDLE_MS = 30 * 60 * 1000;
// Staff activity is written at most this often per session.
const TOUCH_MS = 60 * 1000;

export type SessionState = {
  userId: string;
  kind: string; // web | mobile | admin
  role: string;
  userStatus: string;
  revoked: boolean;
  expiresAt: number;
  lastUsedAt: number;
};

const cache = new Map<string, { state: SessionState | null; at: number }>();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function sessionState(sessionId: string): Promise<SessionState | null> {
  if (!UUID_RE.test(sessionId)) return null;
  const hit = cache.get(sessionId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.state;
  const rows = await db
    .select({
      userId: sessions.userId,
      kind: sessions.kind,
      revokedAt: sessions.revokedAt,
      expiresAt: sessions.expiresAt,
      lastUsedAt: sessions.lastUsedAt,
      role: users.role,
      status: users.status,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sessionId))
    .limit(1);
  const r = rows[0];
  const state: SessionState | null = r
    ? {
        userId: r.userId,
        kind: r.kind,
        role: r.role,
        userStatus: r.status ?? "active",
        revoked: Boolean(r.revokedAt),
        expiresAt: r.expiresAt.getTime(),
        lastUsedAt: r.lastUsedAt.getTime(),
      }
    : null;
  cache.set(sessionId, { state, at: Date.now() });
  if (cache.size > 50_000) cache.clear();
  return state;
}

export const forgetSession = (sessionId: string) => cache.delete(sessionId);

export function forgetUserSessions(userId: string) {
  for (const [id, entry] of cache) if (entry.state?.userId === userId) cache.delete(id);
}

// A staff request: false (and the session revoked) when it has been idle too long,
// otherwise the activity is recorded for the idle timeout.
export async function noteAdminActivity(sessionId: string, state: SessionState): Promise<boolean> {
  const idle = Date.now() - state.lastUsedAt;
  if (idle > ADMIN_IDLE_MS) {
    await db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: "idle" })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
    forgetSession(sessionId);
    return false;
  }
  if (idle > TOUCH_MS) {
    const now = new Date();
    await db.update(sessions).set({ lastUsedAt: now }).where(eq(sessions.id, sessionId));
    state.lastUsedAt = now.getTime();
  }
  return true;
}
