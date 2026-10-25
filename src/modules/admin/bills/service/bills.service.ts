import { listBillsSchema, type ListBillsDto } from "../types/bills.dto.js";
import { listBills, countBills, getBillById } from "../repository/bills.repository.js";

export async function listAdminBills(input: ListBillsDto) {
  const parsed = listBillsSchema.parse(input);
  const from = parsed.from ? new Date(parsed.from) : undefined;
  const to = parsed.to ? new Date(parsed.to) : undefined;

  const limit = parsed.limit;
  const offset = (parsed.page - 1) * parsed.limit;

  const rows = await listBills({
    from,
    to,
    customerId: parsed.customerId,
    search: parsed.search,
    country: parsed.country,
    currency: parsed.currency,
    status: parsed.status,
    type: parsed.type,
    provider: parsed.provider,
    limit,
    offset,
    sort: parsed.sort,
    order: parsed.order,
  });

  const total = await countBills({
    from,
    to,
    customerId: parsed.customerId,
    search: parsed.search,
    country: parsed.country,
    currency: parsed.currency,
    status: parsed.status,
    type: parsed.type,
    provider: parsed.provider,
    limit,
    offset,
    sort: parsed.sort,
    order: parsed.order,
  });

  return {
    data: rows.map((r) => ({
      id: r.id,
      reference: r.internalReference,
      customer: { id: r.userId, name: r.customerName },
      type: r.type,
      amount: r.amount,
      currency: r.currency,
      status: r.status,
      provider: r.provider,
      providerReference: r.providerReference,
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

export async function getAdminBillById(id: string) {
  const row = await getBillById(id);
  if (!row) return null;

  return {
    bill: {
      id: row.id,
      reference: row.internalReference,
      type: row.type,
      amount: row.amount,
      status: row.status,
      provider: row.provider,
      providerReference: row.providerReference,
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
    },
    wallet: {
      id: row.walletId,
      currency: row.currencyCode,
      status: row.walletStatus,
    },
    provider: row.provider ? { name: row.provider, reference: row.providerReference } : undefined,
  };
}
