import { eq, or } from "drizzle-orm";

import { db } from "../../../core/db/client.js";
import { users } from "../../../core/db/schema.js";

export async function findUserByEmailOrPhone(input: {
  email?: string;
  phone?: string;
}) {
  const conditions = [] as Array<ReturnType<typeof eq>>;
  if (input.email) conditions.push(eq(users.email, input.email));
  if (input.phone) conditions.push(eq(users.phone, input.phone));

  if (conditions.length === 0) return null;

  const whereClause =
    conditions.length === 1 ? conditions[0] : or(...conditions);
  const rows = await db.select().from(users).where(whereClause).limit(1);
  return rows[0] ?? null;
}

export async function setUserTelecomReloadlyEnabled(
  userId: string,
  enabled: boolean,
) {
  await db
    .update(users)
    .set({ telecomReloadlyEnabled: enabled })
    .where(eq(users.id, userId));
}

export async function updateUserProfile(
  userId: string,
  input: {
    firstName?: string;
    lastName?: string;
    email?: string | null;
    phone?: string | null;
    countryCode?: string;
    preferredCurrency?: string | null;
  },
) {
  const set: Record<string, any> = {};
  if (input.firstName !== undefined) set.firstName = input.firstName;
  if (input.lastName !== undefined) set.lastName = input.lastName;
  if (input.email !== undefined) set.email = input.email;
  if (input.phone !== undefined) set.phone = input.phone;
  if (input.countryCode !== undefined) set.countryCode = input.countryCode;
  if (input.preferredCurrency !== undefined)
    set.preferredCurrency = input.preferredCurrency;

  if (Object.keys(set).length === 0) return;

  await db.update(users).set(set).where(eq(users.id, userId));
}

export async function updateUserGeoCompliance(
  userId: string,
  input: {
    countryCode?: string;
    region?: string | null;
    preferredCurrency?: string | null;
    complianceRegion?: string | null;
    dataLocalizationRegion?: string | null;
  },
) {
  const set: Record<string, any> = {};
  if (input.countryCode !== undefined) set.countryCode = input.countryCode;
  if (input.region !== undefined) set.region = input.region;
  if (input.preferredCurrency !== undefined)
    set.preferredCurrency = input.preferredCurrency;
  if (input.complianceRegion !== undefined)
    set.complianceRegion = input.complianceRegion;
  if (input.dataLocalizationRegion !== undefined)
    set.dataLocalizationRegion = input.dataLocalizationRegion;

  if (Object.keys(set).length === 0) return;

  await db.update(users).set(set).where(eq(users.id, userId));
}

export async function findUserById(userId: string) {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function createUser(input: {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  passwordHash: string;
  countryCode: string;
  currencyCode: string;
  region?: string | null;
  preferredCurrency?: string | null;
  complianceRegion?: string | null;
  dataLocalizationRegion?: string | null;
  complianceTier?: string | null;
}) {
  const rows = await db
    .insert(users)
    .values({
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      passwordHash: input.passwordHash,
      countryCode: input.countryCode,
      currencyCode: input.currencyCode,
      region: input.region ?? null,
      preferredCurrency: input.preferredCurrency ?? null,
      complianceRegion: input.complianceRegion ?? null,
      dataLocalizationRegion: input.dataLocalizationRegion ?? null,
      complianceTier: input.complianceTier ?? null,
    })
    .returning();

  return rows[0]!;
}

export async function deleteUserById(userId: string) {
  await db.delete(users).where(eq(users.id, userId));
}

export async function ensureNoDuplicateUser(input: {
  email?: string;
  phone?: string;
}) {
  if (!input.email && !input.phone) return;

  const conditions = [] as Array<ReturnType<typeof eq>>;
  if (input.email) conditions.push(eq(users.email, input.email));
  if (input.phone) conditions.push(eq(users.phone, input.phone));

  const whereClause =
    conditions.length === 1 ? conditions[0] : or(...conditions);
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(whereClause)
    .limit(1);

  return rows[0] ?? null;
}
