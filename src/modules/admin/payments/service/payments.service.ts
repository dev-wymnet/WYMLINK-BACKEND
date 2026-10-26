import type { ListPaymentsDto } from "../types/payments.dto.js";
import {
  countLedgerPayments,
  findRelated,
  getLedgerPaymentById,
  listLedgerPayments,
} from "../repository/payments.repository.js";

export async function listAdminPayments(f: ListPaymentsDto) {
  const [rows, total] = await Promise.all([listLedgerPayments(f), countLedgerPayments(f)]);
  return {
    data: rows.map(({ e, firstName, lastName }) => ({
      id: e.id,
      reference: e.reference,
      customer: { id: e.userId, name: `${firstName} ${lastName}`.trim() },
      type: e.entryType,
      direction: e.direction,
      amount: e.amount,
      currency: "NGN",
      balanceBefore: e.balanceBefore,
      balanceAfter: e.balanceAfter,
      status: "success",
      description: e.description,
      relatedType: e.relatedType,
      relatedId: e.relatedId,
      date: e.createdAt,
    })),
    pagination: { page: f.page, limit: f.limit, total, totalPages: Math.ceil(total / f.limit) || 0 },
  };
}

export async function getAdminPaymentById(id: string) {
  const row = await getLedgerPaymentById(id);
  if (!row) return null;
  const { e, user: u, wallet: w } = row;
  const related = await findRelated(e.relatedType, e.relatedId);
  return {
    transaction: {
      id: e.id,
      reference: e.reference,
      type: e.entryType,
      direction: e.direction,
      amount: e.amount,
      currency: "NGN",
      status: "success",
      description: e.description,
      balanceBefore: e.balanceBefore,
      balanceAfter: e.balanceAfter,
      metadata: e.metadata,
      createdAt: e.createdAt,
    },
    customer: { id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email, phone: u.phone, status: u.status },
    wallet: { id: w.id, currency: w.currencyCode, status: w.status, balance: w.availableBalance },
    related,
    provider: related ? { name: related.provider, reference: related.reference, status: related.status } : undefined,
  };
}
