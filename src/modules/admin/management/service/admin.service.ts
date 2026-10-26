import bcrypt from "bcrypt";

import { db } from "../../../../core/db/client.js";
import { ValidationError } from "../../../../core/errors/ValidationError.js";
import { ForbiddenError } from "../../../../core/errors/ForbiddenError.js";
import { forgetUserStatus } from "../../../../core/middleware/authGuard.js";
import { insertAuditLog } from "../../../audit/repository/audit.repository.js";
import { createUser, findContactConflict } from "../../../user/repository/user.repository.js";
import { listSessionsByUser, revokeUserSessions } from "../../../auth/repository/session.repository.js";
import {
  STAFF_ROLES,
  findAdminById,
  listAdmins as repoListAdmins,
  lockActiveSuperAdmins,
  setUserRole,
  setUserStatus,
  type StaffRole,
} from "../repository/admin.repository.js";

type Meta = {
  actorAdminId: string;
  actorRole: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
};

const isStaff = (role: string) => (STAFF_ROLES as readonly string[]).includes(role);

const audit = (m: Meta, action: string, targetId: string, extra: { before?: unknown; after?: unknown } = {}) =>
  insertAuditLog({
    actorUserId: m.actorAdminId,
    actorRole: m.actorRole,
    action,
    targetType: "admin",
    targetId,
    success: true,
    before: extra.before ?? null,
    after: extra.after ?? null,
    ip: m.ip ?? null,
    userAgent: m.userAgent ?? null,
    requestId: m.requestId ?? null,
  });

export async function listAdmins(input: { page: number; limit: number; search?: string | undefined }) {
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 100);
  const page = Math.max(Number(input.page) || 1, 1);
  const { rows, total } = await repoListAdmins({ limit, offset: (page - 1) * limit, search: input.search });
  return {
    data: rows.map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      phone: u.phone,
      role: u.role,
      status: u.status,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  };
}

export async function getAdmin(id: string) {
  const u = await findAdminById(id);
  if (!u || !isStaff(u.role)) return null;
  return {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    phone: u.phone,
    role: u.role,
    status: u.status,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

export async function createAdmin(
  input: Meta & {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string | undefined;
    role: StaffRole;
    temporaryPassword: string;
  },
) {
  if (input.role === "super_admin" && input.actorRole !== "super_admin") {
    throw new ForbiddenError("Only super_admin can create super_admin");
  }
  if (await findContactConflict({ email: input.email, phone: input.phone })) {
    throw new ValidationError("An account with this email or phone already exists");
  }
  const user = await createUser(db, {
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone ?? null,
    passwordHash: await bcrypt.hash(input.temporaryPassword, 12),
    role: input.role,
  });
  await audit(input, "ADMIN_CREATED", user.id, { after: { role: input.role } });
  return { id: user.id };
}

export async function updateAdminStatus(input: Meta & { targetAdminId: string; status: "active" | "disabled" }) {
  if (input.actorAdminId === input.targetAdminId) throw new ForbiddenError("Cannot change own status");

  const before = await db.transaction(async (tx) => {
    const superAdmins = await lockActiveSuperAdmins(tx);
    const u = await findAdminById(input.targetAdminId, tx);
    if (!u || !isStaff(u.role)) throw new ValidationError("Admin not found");
    if (u.role === "super_admin" && u.status === "active" && input.status !== "active" && superAdmins <= 1) {
      throw new ForbiddenError("Cannot deactivate the last super_admin");
    }
    await setUserStatus(tx, u.id, input.status);
    return u.status;
  });

  forgetUserStatus(input.targetAdminId);
  if (input.status !== "active") {
    await revokeUserSessions({ userId: input.targetAdminId, kinds: ["admin"], reason: "admin_disabled" });
  }
  await audit(input, input.status === "active" ? "ADMIN_REACTIVATED" : "ADMIN_DEACTIVATED", input.targetAdminId, {
    before: { status: before },
    after: { status: input.status },
  });
  return { success: true };
}

export async function updateAdminRole(input: Meta & { targetAdminId: string; role: StaffRole }) {
  if (input.actorAdminId === input.targetAdminId) throw new ForbiddenError("Cannot change own role");
  if (input.role === "super_admin" && input.actorRole !== "super_admin") {
    throw new ForbiddenError("Only super_admin can promote to super_admin");
  }

  const before = await db.transaction(async (tx) => {
    const superAdmins = await lockActiveSuperAdmins(tx);
    const u = await findAdminById(input.targetAdminId, tx);
    if (!u || !isStaff(u.role)) throw new ValidationError("Admin not found");
    if (u.role === "super_admin" && u.status === "active" && input.role !== "super_admin" && superAdmins <= 1) {
      throw new ForbiddenError("Cannot remove the last super_admin");
    }
    await setUserRole(tx, u.id, input.role);
    return u.role;
  });

  // New permissions apply from the next sign-in.
  await revokeUserSessions({ userId: input.targetAdminId, kinds: ["admin"], reason: "role_changed" });
  await audit(input, "ADMIN_ROLE_CHANGED", input.targetAdminId, { before: { role: before }, after: { role: input.role } });
  return { success: true };
}

export async function listAdminSessions(userId: string) {
  const rows = await listSessionsByUser(userId);
  return rows
    .filter((s) => s.kind === "admin")
    .map((s) => ({
      id: s.id,
      sessionType: s.kind,
      revoked: Boolean(s.revokedAt),
      revokedReason: s.revokedReason,
      ip: s.ip,
      userAgent: s.userAgent,
      lastUsedAt: s.lastUsedAt,
      expiresAt: s.expiresAt,
      createdAt: s.createdAt,
    }));
}

export async function revokeAdminSessions(input: Meta & { targetAdminId: string }) {
  await revokeUserSessions({ userId: input.targetAdminId, kinds: ["admin"], reason: "revoked_by_admin" });
  await audit(input, "ADMIN_SESSIONS_REVOKED", input.targetAdminId);
  return { success: true };
}
