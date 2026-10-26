import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "../../../core/db/client.js";
import { sessions } from "../../../core/db/schema.js";
import { safeIp } from "../../../core/utils/identity.js";

export type SessionKind = "web" | "mobile" | "admin";
export const CUSTOMER_SESSION_KINDS: SessionKind[] = ["web", "mobile"];

export async function createSession(input: {
  userId: string;
  kind: SessionKind;
  refreshTokenHash: string;
  expiresAt: Date;
  deviceId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const rows = await db
    .insert(sessions)
    .values({
      userId: input.userId,
      kind: input.kind,
      refreshTokenHash: input.refreshTokenHash,
      expiresAt: input.expiresAt,
      deviceId: input.deviceId ?? null,
      ip: safeIp(input.ip),
      userAgent: input.userAgent?.slice(0, 400) ?? null,
    })
    .returning();
  return rows[0]!;
}

export async function findSessionById(sessionId: string) {
  const rows = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  return rows[0] ?? null;
}

export async function touchSession(sessionId: string) {
  await db.update(sessions).set({ lastUsedAt: new Date() }).where(eq(sessions.id, sessionId));
}

export async function revokeSession(sessionId: string, reason: string) {
  await db
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

export async function revokeUserSessions(input: { userId: string; kinds: SessionKind[]; reason: string }) {
  await db
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: input.reason })
    .where(and(eq(sessions.userId, input.userId), inArray(sessions.kind, input.kinds), isNull(sessions.revokedAt)));
}

export async function listSessionsByUser(userId: string) {
  return db.select().from(sessions).where(eq(sessions.userId, userId));
}

export async function listActiveAdminSessions(userId: string) {
  return db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), eq(sessions.kind, "admin"), isNull(sessions.revokedAt)));
}
