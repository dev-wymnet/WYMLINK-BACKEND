import { eq } from 'drizzle-orm';

import { db } from '../../../core/db/client.js';
import { monnifyReservedAccounts } from '../../../core/db/schema.js';

export async function findReservedAccountByWalletId(walletId: string) {
  const rows = await db
    .select()
    .from(monnifyReservedAccounts)
    .where(eq(monnifyReservedAccounts.walletId, walletId))
    .limit(1);
  return rows[0] ?? null;
}

export async function findReservedAccountByAccountReference(accountReference: string) {
  const rows = await db
    .select()
    .from(monnifyReservedAccounts)
    .where(eq(monnifyReservedAccounts.accountReference, accountReference))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertReservedAccount(input: {
  userId: string;
  walletId: string;
  accountReference: string;
  reservationReference?: string | null;
  status?: string | null;
  bankCode?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
  accountName?: string | null;
  rawResponse: unknown;
}) {
  const rows = await db
    .insert(monnifyReservedAccounts)
    .values({
      userId: input.userId,
      walletId: input.walletId,
      accountReference: input.accountReference,
      reservationReference: input.reservationReference ?? null,
      status: input.status ?? null,
      bankCode: input.bankCode ?? null,
      bankName: input.bankName ?? null,
      accountNumber: input.accountNumber ?? null,
      accountName: input.accountName ?? null,
      rawResponse: input.rawResponse as any,
    })
    .returning();

  return rows[0] ?? null;
}
