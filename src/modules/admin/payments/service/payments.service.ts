import {
  listPaymentsSchema,
  type ListPaymentsDto,
} from "../types/payments.dto.js";
import {
  listLedgerPayments,
  countLedgerPayments,
  getLedgerPaymentById,
  findRelatedPayoutByReference,
  findTelecomByInternalReference,
} from "../repository/payments.repository.js";

export async function listAdminPayments(input: ListPaymentsDto) {
  const parsed = listPaymentsSchema.parse(input);
  const from = parsed.from ? new Date(parsed.from) : undefined;
  const to = parsed.to ? new Date(parsed.to) : undefined;

  const limit = parsed.limit;
  const offset = (parsed.page - 1) * parsed.limit;

  const rows = await listLedgerPayments({
    from,
    to,
    customerId: parsed.customerId,
    search: parsed.search,
    country: parsed.country,
    currency: parsed.currency,
    status: parsed.status,
    type: parsed.type,
    direction: parsed.direction,
    provider: parsed.provider,
    limit,
    offset,
    sort: parsed.sort,
    order: parsed.order,
  } as any);

  const total = await countLedgerPayments({
    from,
    to,
    customerId: parsed.customerId,
    search: parsed.search,
    country: parsed.country,
    currency: parsed.currency,
    status: parsed.status,
    type: parsed.type,
    direction: parsed.direction,
    provider: parsed.provider,
    limit,
    offset,
    sort: parsed.sort,
    order: parsed.order,
  } as any);

  return {
    data: rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      customer: { id: r.userId, name: r.customerName },
      type: r.type,
      direction: r.direction,
      amount: r.amount,
      currency: r.currency,
      balanceBefore: r.balanceBefore,
      balanceAfter: r.balanceAfter,
      status: r.status,
      description: r.description,
      date: r.date,
    })),
    pagination: {
      page: parsed.page,
      limit: parsed.limit,
      total,
      totalPages: Math.ceil(total / parsed.limit) || 0,
    },
  };
}

export async function getAdminPaymentById(id: string) {
  const row = await getLedgerPaymentById(id);
  if (!row) return null;

  const relatedPayout = await findRelatedPayoutByReference(row.reference);
  const relatedTelecom = await findTelecomByInternalReference(row.reference);

  return {
    transaction: {
      id: row.id,
      reference: row.reference,
      type: row.type,
      direction: row.direction,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      description: row.description,
      balanceBefore: row.balanceBefore,
      balanceAfter: row.balanceAfter,
      createdAt: row.date,
    },
    customer: {
      id: row.userId,
      firstName: row.userFirst,
      lastName: row.userLast,
      email: row.email,
      phone: row.phone,
      countryCode: row.countryCode,
      currency: row.currencyCode,
      status: undefined,
    },
    wallet: {
      id: row.walletId,
      currency: row.currency,
      status: row.walletStatus,
    },
    provider: relatedPayout
      ? {
          name: "monnify",
          reference: relatedPayout.providerReference ?? null,
          status: relatedPayout.status,
        }
      : relatedTelecom
        ? {
            name: relatedTelecom.provider,
            reference: relatedTelecom.providerReference,
            status: relatedTelecom.status,
          }
        : undefined,
  };
}
