import { eq, or } from "drizzle-orm";

import { db } from "../../../core/db/client.js";
import { users } from "../../../core/db/schema.js";
import { normalizeEmail, normalizePhone } from "../../../core/utils/identity.js";
import type { Executor } from "../../wallet/repository/wallet.repository.js";

export type User = typeof users.$inferSelect;

function contactCondition(input: { email?: string | null | undefined; phone?: string | null | undefined }) {
  const conditions = [];
  if (input.email) conditions.push(eq(users.email, normalizeEmail(input.email)));
  if (input.phone) conditions.push(eq(users.phone, normalizePhone(input.phone)));
  if (conditions.length === 0) return null;
  return conditions.length === 1 ? conditions[0]! : or(...conditions)!;
}

export async function findUserByEmailOrPhone(input: { email?: string | undefined; phone?: string | undefined }) {
  const where = contactCondition(input);
  if (!where) return null;
  const rows = await db.select().from(users).where(where).limit(1);
  return rows[0] ?? null;
}

// Another account already using this email or phone (excluding `exceptUserId`).
export async function findContactConflict(input: {
  email?: string | null | undefined;
  phone?: string | null | undefined;
  exceptUserId?: string | undefined;
}) {
  const where = contactCondition(input);
  if (!where) return null;
  const rows = await db.select({ id: users.id }).from(users).where(where).limit(2);
  return rows.find((r) => r.id !== input.exceptUserId) ?? null;
}

export async function findUserById(userId: string, ex: Executor = db) {
  const rows = await ex.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0] ?? null;
}

export async function createUser(
  ex: Executor,
  input: {
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    passwordHash: string;
    role?: string;
  },
) {
  const rows = await ex
    .insert(users)
    .values({
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      email: input.email ? normalizeEmail(input.email) : null,
      phone: input.phone ? normalizePhone(input.phone) : null,
      passwordHash: input.passwordHash,
      role: input.role ?? "customer",
    })
    .returning();
  return rows[0]!;
}

export async function updateUserProfile(
  userId: string,
  input: {
    firstName?: string | undefined;
    lastName?: string | undefined;
    email?: string | null | undefined;
    phone?: string | null | undefined;
  },
) {
  const set: Partial<typeof users.$inferInsert> = {};
  if (input.firstName !== undefined) set.firstName = input.firstName.trim();
  if (input.lastName !== undefined) set.lastName = input.lastName.trim();
  if (input.email !== undefined) set.email = input.email ? normalizeEmail(input.email) : null;
  if (input.phone !== undefined) set.phone = input.phone ? normalizePhone(input.phone) : null;
  if (Object.keys(set).length === 0) return;
  await db.update(users).set(set).where(eq(users.id, userId));
}

export async function setUserReloadlyEnabled(userId: string, enabled: boolean) {
  await db.update(users).set({ reloadlyEnabled: enabled }).where(eq(users.id, userId));
}

export async function touchLastLogin(userId: string) {
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
}

// Public shape of a user (never the hashes).
export function toUserDto(u: User) {
  return {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    phone: u.phone,
    emailVerified: Boolean(u.emailVerifiedAt),
    phoneVerified: Boolean(u.phoneVerifiedAt),
    role: u.role,
    status: u.status,
    kycTier: u.kycTier,
    countryCode: "NG",
    currencyCode: "NGN",
    transactionPinSet: Boolean(u.transactionPinHash),
    passcodeSet: Boolean(u.passcodeHash),
    createdAt: u.createdAt,
  };
}
