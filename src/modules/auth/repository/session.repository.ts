import { and, eq } from "drizzle-orm";

import { db } from "../../../core/db/client.js";
import { sessions } from "../../../core/db/schema.js";

export async function createSession(input: {
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  sessionType?: "customer" | "customer_mobile" | "admin";
  deviceId?: string | null;
}) {
  const rows = await db
    .insert(sessions)
    .values({
      userId: input.userId,
      refreshTokenHash: input.refreshTokenHash,
      expiresAt: input.expiresAt,
      sessionType: input.sessionType ?? "customer",
      deviceId: input.deviceId ?? null,
    })
    .returning();

  return rows[0]!;
}

export async function findSessionById(sessionId: string) {
  const rows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteSessionById(sessionId: string) {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function revokeUserSessionsByType(input: {
  userId: string;
  sessionType: "customer" | "customer_mobile" | "admin";
}) {
  await db
    .update(sessions)
    .set({ revoked: true, expiresAt: new Date(0) })
    .where(
      and(
        eq(sessions.userId, input.userId),
        eq(sessions.sessionType, input.sessionType),
        eq(sessions.revoked, false),
      ),
    );
}

export async function listSessionsByUser(userId: string) {
  return db.select().from(sessions).where(eq(sessions.userId, userId));
}

export async function listActiveAdminSessions(userId: string) {
  return db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        eq(sessions.sessionType, "admin"),
        eq(sessions.revoked, false),
      ),
    );
}
