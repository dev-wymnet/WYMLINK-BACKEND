import bcrypt from "bcrypt";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";

import { db } from "../../../../core/db/client.js";
import { users } from "../../../../core/db/schema.js";
import { ValidationError } from "../../../../core/errors/ValidationError.js";
import { ForbiddenError } from "../../../../core/errors/ForbiddenError.js";
import { insertAuditLog } from "../../../audit/repository/audit.repository.js";
import {
  countActiveSuperAdminsTx,
  findAdminById,
  listAdmins as repoListAdmins,
  setUserRoleTx,
  setUserStatusTx,
} from "../repository/admin.repository.js";
import { ensureNoDuplicateUser } from "../../../user/repository/user.repository.js";
import { findEnabledCountryByCode } from "../../../country/repository/country.repository.js";
import { resolveRegionForCountry } from "../../../geolocation/service/geolocation.service.js";
import { createUser } from "../../../user/repository/user.repository.js";
import {
  listSessionsByUser,
  revokeUserSessionsByType,
} from "../../../auth/repository/session.repository.js";

export async function listAdmins(input: {
  page: number;
  limit: number;
  search?: string;
}) {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const offset = (Math.max(input.page ?? 1, 1) - 1) * limit;
  const rows = await repoListAdmins({
    limit,
    ...(input.search !== undefined ? { search: input.search } : {}),
  });
  // TODO: count could be added if needed. Keeping simple for now.
  return {
    data: rows.map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      phone: u.phone,
      role: u.role,
      status: u.status,
      createdAt: u.createdAt,
    })),
    pagination: { page: input.page, limit, total: rows.length, totalPages: 1 },
  };
}

export async function getAdmin(id: string) {
  const row = await findAdminById(id);
  if (
    !row ||
    !["super_admin", "business_admin", "finance_admin"].includes(row.role)
  )
    return null;
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
    role: row.role,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createAdmin(input: {
  actorAdminId: string;
  actorRole: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  countryCode: string;
  role: "business_admin" | "finance_admin" | "super_admin";
  temporaryPassword: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}) {
  if (input.role === "super_admin" && input.actorRole !== "super_admin") {
    throw new ForbiddenError("Only super_admin can create super_admin");
  }

  const duplicate = await ensureNoDuplicateUser({
    email: input.email,
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
  });
  if (duplicate) throw new ValidationError("User already exists");

  const country = await findEnabledCountryByCode(input.countryCode);
  if (!country) throw new ValidationError("Unsupported country");
  const regionInfo = await resolveRegionForCountry({
    countryCode: country.code,
  });

  const passwordHash = await bcrypt.hash(input.temporaryPassword, 12);

  const user = await db.transaction(async (tx) => {
    const created = await tx
      .insert(users)
      .values({
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone ?? null,
        passwordHash,
        countryCode: country.code,
        currencyCode: country.currencyCode,
        region: regionInfo?.region ?? null,
        preferredCurrency:
          regionInfo?.preferredCurrency ?? country.currencyCode,
        complianceRegion: regionInfo?.complianceRegion ?? null,
        dataLocalizationRegion: regionInfo?.complianceRegion ?? null,
        complianceTier: "tier_1",
        role: "customer", // set then update to ensure constraints; or set directly
        status: "active",
      })
      .returning();

    const u = created[0]!;

    // Set role now
    await setUserRoleTx(tx, u.id, input.role);

    return { ...u, role: input.role };
  });

  await insertAuditLog({
    actorAdminId: input.actorAdminId,
    actorRole: input.actorRole,
    action: "ADMIN_CREATED",
    targetType: "admin",
    targetId: user.id,
    ip: input.ip,
    userAgent: input.userAgent,
    success: true,
    requestId: input.requestId,
  });

  return { id: user.id };
}

export async function updateAdminStatus(input: {
  actorAdminId: string;
  actorRole: string;
  targetAdminId: string;
  status: "active" | "disabled";
  ip?: string;
  userAgent?: string;
  requestId?: string;
}) {
  if (input.actorAdminId === input.targetAdminId) {
    throw new ForbiddenError("Cannot change own status");
  }

  await db.transaction(async (tx) => {
    const target = await tx
      .select()
      .from(users)
      .where(eq(users.id, input.targetAdminId))
      .limit(1);
    const u = target[0];
    if (!u) throw new ValidationError("Admin not found");
    if (
      !["super_admin", "business_admin", "finance_admin"].includes(
        String(u.role),
      )
    )
      throw new ValidationError("Not an admin");

    if (u.role === "super_admin" && input.status !== "active") {
      const count = await countActiveSuperAdminsTx(tx);
      if (count <= 1)
        throw new ForbiddenError("Cannot deactivate the last super_admin");
    }

    await setUserStatusTx(tx, u.id, input.status);
    if (input.status !== "active") {
      await revokeUserSessionsByType({ userId: u.id, sessionType: "admin" });
    }
  });

  await insertAuditLog({
    actorAdminId: input.actorAdminId,
    actorRole: input.actorRole,
    action:
      input.status === "active" ? "ADMIN_REACTIVATED" : "ADMIN_DEACTIVATED",
    targetType: "admin",
    targetId: input.targetAdminId,
    ip: input.ip,
    userAgent: input.userAgent,
    success: true,
    requestId: input.requestId,
  });

  return { success: true };
}

export async function updateAdminRole(input: {
  actorAdminId: string;
  actorRole: string;
  targetAdminId: string;
  role: "business_admin" | "finance_admin" | "super_admin";
  ip?: string;
  userAgent?: string;
  requestId?: string;
}) {
  if (input.actorAdminId === input.targetAdminId) {
    throw new ForbiddenError("Cannot change own role");
  }

  if (input.role === "super_admin" && input.actorRole !== "super_admin") {
    throw new ForbiddenError("Only super_admin can promote to super_admin");
  }

  await db.transaction(async (tx) => {
    const target = await tx
      .select()
      .from(users)
      .where(eq(users.id, input.targetAdminId))
      .limit(1);
    const u = target[0];
    if (!u) throw new ValidationError("Admin not found");
    if (
      !["super_admin", "business_admin", "finance_admin"].includes(
        String(u.role),
      )
    )
      throw new ValidationError("Not an admin");

    if (u.role === "super_admin" && input.role !== "super_admin") {
      const count = await countActiveSuperAdminsTx(tx);
      if (count <= 1)
        throw new ForbiddenError("Cannot remove last super_admin");
    }

    await setUserRoleTx(tx, u.id, input.role);
    await revokeUserSessionsByType({ userId: u.id, sessionType: "admin" });
  });

  await insertAuditLog({
    actorAdminId: input.actorAdminId,
    actorRole: input.actorRole,
    action: "ADMIN_ROLE_CHANGED",
    targetType: "admin",
    targetId: input.targetAdminId,
    ip: input.ip,
    userAgent: input.userAgent,
    success: true,
    requestId: input.requestId,
  });

  return { success: true };
}

export async function listAdminSessions(userId: string) {
  const rows = await listSessionsByUser(userId);
  return rows.map((s) => ({
    id: s.id,
    sessionType: s.sessionType,
    revoked: s.revoked,
    expiresAt: s.expiresAt,
    createdAt: s.createdAt,
  }));
}

export async function revokeAdminSessions(input: {
  actorAdminId: string;
  actorRole: string;
  targetAdminId: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}) {
  await revokeUserSessionsByType({
    userId: input.targetAdminId,
    sessionType: "admin",
  });
  await insertAuditLog({
    actorAdminId: input.actorAdminId,
    actorRole: input.actorRole,
    action: "ADMIN_SESSIONS_REVOKED",
    targetType: "admin",
    targetId: input.targetAdminId,
    ip: input.ip,
    userAgent: input.userAgent,
    success: true,
    requestId: input.requestId,
  });
  return { success: true };
}
