import { NotFoundError } from "../../../../core/errors/NotFoundError.js";
import { insertAuditLog } from "../../../audit/repository/audit.repository.js";
import { OPEN_ORDER_STATUSES as OPEN, resolveOrder } from "../../../vtu/vtu.service.js";
import type { ListBillsDto } from "../types/bills.dto.js";
import { countBills, getBillById, listBills } from "../repository/bills.repository.js";

export async function listAdminBills(f: ListBillsDto) {
  const [rows, total] = await Promise.all([listBills(f), countBills(f)]);
  return {
    data: rows.map(({ order: o, firstName, lastName }) => ({
      id: o.id,
      reference: o.reference,
      customer: { id: o.userId, name: `${firstName} ${lastName}`.trim() },
      type: o.product,
      service: o.service,
      planName: o.planName,
      recipient: o.recipient,
      amount: o.amount,
      currency: "NGN",
      status: o.status,
      needsAttention: OPEN.includes(o.status),
      provider: o.provider,
      providerReference: o.providerReference,
      date: o.createdAt,
    })),
    pagination: { page: f.page, limit: f.limit, total, totalPages: Math.ceil(total / f.limit) || 0 },
  };
}

export async function getAdminBillById(id: string) {
  const row = await getBillById(id);
  if (!row) return null;
  const { order: o, user: u } = row;
  return {
    bill: {
      id: o.id,
      reference: o.reference,
      type: o.product,
      service: o.service,
      planCode: o.planCode,
      planName: o.planName,
      recipient: o.recipient,
      recipientName: o.recipientName,
      meterType: o.meterType,
      amount: o.amount,
      status: o.status,
      needsAttention: OPEN.includes(o.status),
      token: o.token,
      units: o.units,
      lastError: o.lastError,
      provider: o.provider,
      providerReference: o.providerReference,
      providerResponse: o.providerResponse,
      createdAt: o.createdAt,
      completedAt: o.completedAt,
    },
    customer: { id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email, phone: u.phone },
    provider: { name: o.provider, reference: o.providerReference },
  };
}

// Settles an order the provider never confirmed, after staff checked the provider's dashboard.
export async function resolveAdminBill(input: {
  id: string;
  decision: "delivered" | "refund";
  note: string;
  actorAdminId: string;
  actorRole?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
}) {
  const before = await getBillById(input.id);
  if (!before) throw new NotFoundError("Bill not found");
  const after = await resolveOrder({ orderId: input.id, decision: input.decision, note: input.note });
  await insertAuditLog({
    actorUserId: input.actorAdminId,
    actorRole: input.actorRole ?? null,
    action: input.decision === "delivered" ? "BILL_MARKED_DELIVERED" : "BILL_REFUNDED",
    targetType: "vtu_order",
    targetId: input.id,
    success: true,
    reason: input.note,
    before: { status: before.order.status },
    after: { status: after.status },
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  });
  return getAdminBillById(input.id);
}
