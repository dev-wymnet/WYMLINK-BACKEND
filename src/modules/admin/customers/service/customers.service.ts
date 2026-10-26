import { db } from "../../../../core/db/client.js";
import { auditLog } from "../../../../core/db/schema.js";
import { safeIp } from "../../../../core/utils/identity.js";
import { NotFoundError } from "../../../../core/errors/NotFoundError.js";
import { ValidationError } from "../../../../core/errors/ValidationError.js";
import { insertAuditLog } from "../../../audit/repository/audit.repository.js";
import { forgetUserStatus } from "../../../../core/middleware/authGuard.js";
import { CUSTOMER_SESSION_KINDS, revokeUserSessions } from "../../../auth/repository/session.repository.js";
import { getKycProfile } from "../../../verification/repository/verification.repository.js";
import { reviewKyc } from "../../../verification/service/verification.service.js";
import { toLedgerDto } from "../../../wallet/service/wallet.service.js";
import {
  countCustomerLedger,
  countCustomers,
  getCustomerWallet,
  getCustomerWithKyc,
  listCustomerLedger,
  listCustomers,
  setCustomerStatus,
  type ListCustomerTransactionsInput,
  type ListCustomersInput,
} from "../repository/customers.repository.js";

type Meta = {
  actorAdminId: string;
  actorRole?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
};

// API statuses are upper-case: NONE (not submitted), PENDING (awaiting review), VERIFIED, FAILED.
const up = (s: string | null | undefined) => (s ?? "none").toUpperCase();

function overallKyc(bvn: string, nin: string) {
  if (bvn === "VERIFIED" || nin === "VERIFIED") return "verified";
  if (bvn === "PENDING" || nin === "PENDING") return "review";
  if (bvn === "FAILED" || nin === "FAILED") return "failed";
  return "none";
}

const paginate = (input: { page: number; limit: number }, total: number) => {
  const limit = Math.min(Math.max(input.limit, 1), 200);
  return { page: Math.max(input.page, 1), limit, total, totalPages: Math.ceil(total / limit) || 1 };
};

export async function listCustomersAdmin(input: ListCustomersInput) {
  const [rows, total] = await Promise.all([listCustomers(input), countCustomers(input)]);
  return {
    data: rows.map((r) => {
      const bvnStatus = up(r.bvnStatus);
      const ninStatus = up(r.ninStatus);
      return {
        id: r.id,
        firstName: r.firstName,
        lastName: r.lastName,
        name: `${r.firstName} ${r.lastName}`.trim(),
        email: r.email,
        phone: r.phone,
        status: r.status,
        kycTier: r.kycTier,
        kycStatus: overallKyc(bvnStatus, ninStatus),
        bvnStatus,
        ninStatus,
        joinedAt: r.createdAt,
      };
    }),
    pagination: paginate(input, total),
  };
}

export async function getCustomerAdmin(customerId: string) {
  const row = await getCustomerWithKyc(customerId);
  if (!row || row.user.role !== "customer") throw new NotFoundError("Customer not found");
  const { user: u, kyc: k } = row;
  const wallet = await getCustomerWallet(customerId);
  const bvnStatus = up(k?.bvnStatus);
  const ninStatus = up(k?.ninStatus);

  return {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    name: `${u.firstName} ${u.lastName}`.trim(),
    email: u.email,
    phone: u.phone,
    emailVerified: Boolean(u.emailVerifiedAt),
    phoneVerified: Boolean(u.phoneVerifiedAt),
    countryCode: "NG",
    currencyCode: "NGN",
    status: u.status,
    role: u.role,
    kycTier: u.kycTier,
    telecomReloadlyEnabled: u.reloadlyEnabled,
    transactionPinSet: Boolean(u.transactionPinHash),
    lastLoginAt: u.lastLoginAt,
    // Only the last 4 digits exist: full BVN/NIN numbers are never stored.
    kyc: {
      status: overallKyc(bvnStatus, ninStatus),
      tier: u.kycTier,
      provider: k?.provider ?? null,
      bvn: { last4: k?.bvnLast4 ?? null, status: bvnStatus, verifiedAt: k?.bvnVerifiedAt ?? null },
      nin: { last4: k?.ninLast4 ?? null, status: ninStatus, verifiedAt: k?.ninVerifiedAt ?? null },
    },
    wallets: wallet
      ? [{ id: wallet.id, currencyCode: wallet.currencyCode, availableBalance: wallet.availableBalance, lockedBalance: "0.00", status: wallet.status, createdAt: wallet.createdAt }]
      : [],
    joinedAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

export async function listCustomerTransactionsAdmin(input: ListCustomerTransactionsInput) {
  const [rows, total] = await Promise.all([listCustomerLedger(input), countCustomerLedger(input)]);
  return {
    data: rows.map((e) => {
      const dto = toLedgerDto(e);
      return { ...dto, type: dto.transactionType, reference: dto.referenceCode, currency: "NGN", walletId: e.walletId };
    }),
    pagination: paginate(input, total),
  };
}

export async function updateCustomerStatus(input: Meta & { customerId: string; status: "active" | "disabled"; reason?: string | undefined }) {
  await db.transaction(async (tx) => {
    const row = await getCustomerWithKyc(input.customerId, tx);
    if (!row) throw new NotFoundError("Customer not found");
    if (row.user.role !== "customer") throw new ValidationError("Not a customer account");
    if (row.user.status === input.status) throw new ValidationError(`Customer status is already ${input.status}`);
    await setCustomerStatus(tx, input.customerId, input.status);
    // Audited in the same transaction as the change.
    await tx.insert(auditLog).values({
      actorUserId: input.actorAdminId,
      actorRole: input.actorRole ?? null,
      action: "CUSTOMER_STATUS_UPDATED",
      targetType: "customer",
      targetId: input.customerId,
      success: true,
      reason: input.reason ?? null,
      before: { status: row.user.status },
      after: { status: input.status },
      ip: safeIp(input.ip),
      userAgent: input.userAgent ?? null,
      requestId: input.requestId ?? null,
    });
  });

  // Take effect immediately: drop the cached status and end the customer's sessions.
  forgetUserStatus(input.customerId);
  if (input.status !== "active") {
    await revokeUserSessions({ userId: input.customerId, kinds: CUSTOMER_SESSION_KINDS, reason: "account_disabled" });
  }
  return { success: true };
}

export async function reviewCustomerKyc(input: Meta & { customerId: string; type: "bvn" | "nin"; decision: "approve" | "reject"; reason: string }) {
  const row = await getCustomerWithKyc(input.customerId);
  if (!row || row.user.role !== "customer") throw new NotFoundError("Customer not found");

  const before = await getKycProfile(input.customerId);
  const status = input.type === "bvn" ? before?.bvnStatus : before?.ninStatus;
  const label = input.type.toUpperCase();
  if (input.decision === "approve" && status === "verified") throw new ValidationError(`${label} is already verified`);
  if (input.decision === "reject" && status === "failed") throw new ValidationError(`${label} is already marked as failed`);

  await reviewKyc({ userId: input.customerId, kind: input.type, decision: input.decision, reason: input.reason });

  await insertAuditLog({
    actorUserId: input.actorAdminId,
    actorRole: input.actorRole ?? null,
    action: input.decision === "approve" ? "CUSTOMER_KYC_APPROVED" : "CUSTOMER_KYC_REJECTED",
    targetType: "customer",
    targetId: input.customerId,
    success: true,
    reason: input.reason,
    before: { type: input.type, status: status ?? "none" },
    after: { type: input.type, status: input.decision === "approve" ? "verified" : "failed" },
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    requestId: input.requestId ?? null,
  });

  return getCustomerAdmin(input.customerId);
}
