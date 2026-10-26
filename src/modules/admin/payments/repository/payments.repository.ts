import { and, asc, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";

import { db } from "../../../../core/db/client.js";
import { deposits, payouts, users, vtuOrders, walletLedger, wallets } from "../../../../core/db/schema.js";
import type { ListPaymentsDto } from "../types/payments.dto.js";

const escapeLike = (s: string) => s.replace(/[%_\\]/g, (ch) => "\\" + ch);

function where(f: ListPaymentsDto) {
  const c: SQL[] = [];
  if (f.from) c.push(gte(walletLedger.createdAt, new Date(f.from)));
  if (f.to) c.push(lte(walletLedger.createdAt, new Date(f.to)));
  if (f.customerId) c.push(eq(walletLedger.userId, f.customerId));
  if (f.type) c.push(eq(walletLedger.entryType, f.type));
  if (f.direction) c.push(eq(walletLedger.direction, f.direction));
  if (f.search) {
    const like = `%${escapeLike(f.search)}%`;
    c.push(
      or(
        ilike(walletLedger.reference, like),
        ilike(walletLedger.description, like),
        ilike(users.firstName, like),
        ilike(users.lastName, like),
        sql`${users.email}::text ilike ${like}`,
        ilike(users.phone, like),
      )!,
    );
  }
  return c.length ? and(...c) : undefined;
}

export async function listLedgerPayments(f: ListPaymentsDto) {
  const dir = f.order === "asc" ? asc : desc;
  return db
    .select({ e: walletLedger, firstName: users.firstName, lastName: users.lastName })
    .from(walletLedger)
    .innerJoin(users, eq(users.id, walletLedger.userId))
    .where(where(f))
    .orderBy(f.sort === "amount" ? dir(walletLedger.amount) : dir(walletLedger.createdAt))
    .limit(f.limit)
    .offset((f.page - 1) * f.limit);
}

export async function countLedgerPayments(f: ListPaymentsDto) {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(walletLedger)
    .innerJoin(users, eq(users.id, walletLedger.userId))
    .where(where(f));
  return row?.c ?? 0;
}

export async function getLedgerPaymentById(id: string) {
  const [row] = await db
    .select({ e: walletLedger, user: users, wallet: wallets })
    .from(walletLedger)
    .innerJoin(users, eq(users.id, walletLedger.userId))
    .innerJoin(wallets, eq(wallets.id, walletLedger.walletId))
    .where(eq(walletLedger.id, id))
    .limit(1);
  return row ?? null;
}

// The order, payout or deposit a ledger line belongs to.
export async function findRelated(relatedType: string | null, relatedId: string | null) {
  if (!relatedId) return null;
  if (relatedType === "vtu_order") {
    const [o] = await db.select().from(vtuOrders).where(eq(vtuOrders.id, relatedId)).limit(1);
    return o ? { kind: "vtu_order" as const, id: o.id, provider: o.provider, reference: o.providerReference, status: o.status } : null;
  }
  if (relatedType === "payout") {
    const [p] = await db.select().from(payouts).where(eq(payouts.id, relatedId)).limit(1);
    return p ? { kind: "payout" as const, id: p.id, provider: p.provider, reference: p.providerReference, status: p.status } : null;
  }
  if (relatedType === "deposit") {
    const [d] = await db.select().from(deposits).where(eq(deposits.id, relatedId)).limit(1);
    return d ? { kind: "deposit" as const, id: d.id, provider: d.provider, reference: d.providerReference, status: d.status } : null;
  }
  return null;
}
