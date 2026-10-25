import { db } from "../../../../core/db/client.js";
import { NotFoundError } from "../../../../core/errors/NotFoundError.js";
import { ValidationError } from "../../../../core/errors/ValidationError.js";
import { insertAuditLog } from "../../../audit/repository/audit.repository.js";
import { forgetUserStatus } from "../../../../core/middleware/authGuard.js";
import { revokeUserSessionsByType } from "../../../auth/repository/session.repository.js";
import { getUserVerification, upsertUserVerification } from "../../../verification/repository/verification.repository.js";
import {
  countCustomerLedger,
  countCustomers,
  getCustomerWallets,
  getCustomerWithKyc,
  listCustomerLedger,
  listCustomers,
  setCustomerStatusTx,
  type ListCustomerTransactionsInput,
  type ListCustomersInput,
} from "../repository/customers.repository.js";

function resolveKycStatus(bvnStatus: string | null, ninStatus: string | null) {
  if (bvnStatus === "VERIFIED" || ninStatus === "VERIFIED") return "verified";
  if (bvnStatus === "FAILED" || ninStatus === "FAILED") return "failed";
  return "pending";
}

function mapCustomer(row: Awaited<ReturnType<typeof listCustomers>>[number]) {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    name: [row.firstName, row.lastName].filter(Boolean).join(" "),
    email: row.email,
    phone: row.phone,
    countryCode: row.countryCode,
    currencyCode: row.currencyCode,
    status: row.status,
    kycStatus: resolveKycStatus(row.bvnStatus, row.ninStatus),
    bvnStatus: row.bvnStatus ?? "PENDING",
    ninStatus: row.ninStatus ?? "PENDING",
    joinedAt: row.createdAt,
  };
}

export async function listCustomersAdmin(input: ListCustomersInput) {
  const [data, total] = await Promise.all([
    listCustomers(input),
    countCustomers(input),
  ]);

  const limit = Math.min(Math.max(input.limit, 1), 200);
  const page = Math.max(input.page, 1);
  const totalPages = Math.ceil(total / limit) || 1;

  return {
    data: data.map(mapCustomer),
    pagination: { page, limit, total, totalPages },
  };
}

export async function getCustomerAdmin(customerId: string) {
  const row = await getCustomerWithKyc(customerId);
  if (!row) throw new NotFoundError("Customer not found");

  const wallets = await getCustomerWallets(customerId);

  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    name: [row.firstName, row.lastName].filter(Boolean).join(" "),
    email: row.email,
    phone: row.phone,
    countryCode: row.countryCode,
    currencyCode: row.currencyCode,
    preferredCurrency: row.preferredCurrency,
    region: row.region,
    complianceRegion: row.complianceRegion,
    dataLocalizationRegion: row.dataLocalizationRegion,
    complianceTier: row.complianceTier,
    status: row.status,
    role: row.role,
    telecomReloadlyEnabled: row.telecomReloadlyEnabled,
    kyc: {
      status: resolveKycStatus(row.bvnStatus, row.ninStatus),
      bvn: {
        number: row.bvn,
        last4: row.bvnSuffix ?? null,
        status: row.bvnStatus ?? "PENDING",
        verifiedAt: row.bvnVerifiedAt,
        providerReference: row.bvnProviderReference,
        failureReason: row.bvnFailureReason,
      },
      nin: {
        number: row.nin,
        last4: row.ninSuffix ?? null,
        status: row.ninStatus ?? "PENDING",
        verifiedAt: row.ninVerifiedAt,
        providerReference: row.ninProviderReference,
        failureReason: row.ninFailureReason,
      },
    },
    wallets: wallets.map((w) => ({
      id: w.id,
      currencyCode: w.currencyCode,
      availableBalance: w.availableBalance,
      lockedBalance: w.lockedBalance,
      status: w.status,
      createdAt: w.createdAt,
    })),
    joinedAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listCustomerTransactionsAdmin(
  input: ListCustomerTransactionsInput,
) {
  const [data, total] = await Promise.all([
    listCustomerLedger(input),
    countCustomerLedger(input),
  ]);

  const limit = Math.min(Math.max(input.limit, 1), 200);
  const page = Math.max(input.page, 1);
  const totalPages = Math.ceil(total / limit) || 1;

  return {
    data: data.map((t) => ({
      id: t.id,
      walletId: t.walletId,
      type: t.transactionType,
      direction: t.direction,
      amount: t.amount,
      currency: t.currencyCode,
      balanceBefore: t.balanceBefore,
      balanceAfter: t.balanceAfter,
      reference: t.referenceCode,
      relatedOrderId: t.relatedOrderId,
      description: t.description,
      status: t.status,
      createdAt: t.createdAt,
    })),
    pagination: { page, limit, total, totalPages },
  };
}

export async function updateCustomerStatus(input: {
  actorAdminId: string;
  actorRole?: string | undefined;
  customerId: string;
  status: "active" | "disabled";
  reason?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
}) {
  await db.transaction(async (tx) => {
    const customer = await getCustomerWithKyc(input.customerId);
    if (!customer) throw new NotFoundError("Customer not found");
    if (customer.role !== "customer")
      throw new ValidationError("Not a customer account");

    if (customer.status === input.status) {
      throw new ValidationError(`Customer status is already ${input.status}`);
    }

    const before = { status: customer.status };
    const after = { status: input.status };

    await setCustomerStatusTx(tx, input.customerId, input.status);

    await insertAuditLog({
      actorAdminId: input.actorAdminId,
      actorRole: input.actorRole,
      action: "CUSTOMER_STATUS_UPDATED",
      targetType: "customer",
      targetId: input.customerId,
      ip: input.ip,
      userAgent: input.userAgent,
      success: true,
      reason: input.reason,
      before,
      after,
      requestId: input.requestId,
    });
  });

  // Take effect immediately: drop the cached status and end the customer's sessions.
  forgetUserStatus(input.customerId);
  if (input.status !== "active") {
    await revokeUserSessionsByType({ userId: input.customerId, sessionType: "customer" });
    await revokeUserSessionsByType({ userId: input.customerId, sessionType: "customer_mobile" });
  }

  return { success: true };
}

export async function reviewCustomerKyc(input: {
  actorAdminId: string;
  actorRole?: string | undefined;
  customerId: string;
  type: "bvn" | "nin";
  decision: "approve" | "reject";
  reason: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
}) {
  const customer = await getCustomerWithKyc(input.customerId);
  if (!customer) throw new NotFoundError("Customer not found");
  if (customer.role !== "customer") throw new ValidationError("Not a customer account");

  const ver = await getUserVerification(input.customerId);
  const isBvn = input.type === "bvn";
  const status = (isBvn ? ver?.bvnStatus : ver?.ninStatus) ?? "PENDING";
  const suffix = isBvn ? ver?.bvnSuffix : ver?.ninSuffix;
  const label = input.type.toUpperCase();

  if (input.decision === "approve") {
    if (!suffix) throw new ValidationError(`The customer hasn't submitted a ${label} yet`);
    if (status === "VERIFIED") throw new ValidationError(`${label} is already verified`);
  } else if (status === "FAILED") {
    throw new ValidationError(`${label} is already marked as failed`);
  }

  const now = new Date();
  const note = `manual_review: ${input.reason}`;
  const after =
    input.decision === "approve"
      ? { status: "VERIFIED", verifiedAt: now.toISOString(), reason: note }
      : { status: "FAILED", verifiedAt: null, reason: note };

  await upsertUserVerification({
    userId: input.customerId,
    ...(isBvn
      ? {
          bvnStatus: after.status as "VERIFIED" | "FAILED",
          bvnVerifiedAt: input.decision === "approve" ? now : null,
          bvnFailureReason: input.decision === "approve" ? null : note,
        }
      : {
          ninStatus: after.status as "VERIFIED" | "FAILED",
          ninVerifiedAt: input.decision === "approve" ? now : null,
          ninFailureReason: input.decision === "approve" ? null : note,
        }),
  });

  await insertAuditLog({
    actorAdminId: input.actorAdminId,
    actorRole: input.actorRole,
    action: input.decision === "approve" ? "CUSTOMER_KYC_APPROVED" : "CUSTOMER_KYC_REJECTED",
    targetType: "customer",
    targetId: input.customerId,
    ip: input.ip,
    userAgent: input.userAgent,
    success: true,
    reason: input.reason,
    before: { type: input.type, status },
    after: { type: input.type, ...after },
    requestId: input.requestId,
  });

  return getCustomerAdmin(input.customerId);
}
