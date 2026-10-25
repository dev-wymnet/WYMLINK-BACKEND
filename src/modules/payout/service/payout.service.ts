import { randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";

import { db } from "../../../core/db/client.js";
import { ValidationError } from "../../../core/errors/ValidationError.js";
import { TooManyTransactionsError } from "../../../core/errors/AppError.js";
import { parseMoneyToCents } from "../../../core/utils/money.js";
import { findUserById } from "../../user/repository/user.repository.js";
import { ensureWalletForUser } from "../../wallet/service/wallet.service.js";
import {
  lockWalletRowTx,
  debitWalletAtomicTx,
} from "../../wallet/repository/wallet.repository.js";
import { enforceNgVerificationRequirement } from "../../compliance/service/ngVerification.service.js";
import {
  monnifyNameEnquiry,
  monnifyCreateSingleDisbursement,
  monnifyGetBanks,
} from "../../monnify/client/monnify.client.js";
import {
  insertPayout,
  findPayoutByReference,
  findPayoutById,
  updatePayoutStatusAtomic,
} from "../repository/payout.repository.js";
import { payouts } from "../../../core/db/schema.js";
import type {
  CreatePayoutInput,
  ValidateAccountInput,
} from "../types/payout.dto.js";
import { enqueuePayout } from "../worker/payout.worker.js";

export async function createPayout(
  input: { userId: string } & CreatePayoutInput,
) {
  const user = await findUserById(input.userId);
  if (!user) throw new ValidationError("User not found");

  const wallet = await ensureWalletForUser({
    userId: input.userId,
    currencyCode: user.currencyCode,
  });

  // Name enquiry before any wallet lock/transaction; do not trust client-provided name
  let nameInfo: Awaited<ReturnType<typeof monnifyNameEnquiry>>;
  try {
    nameInfo = await monnifyNameEnquiry({
      accountNumber: input.accountNumber,
      bankCode: input.bankCode,
    });
  } catch (e) {
    // Surface provider validation failures as a client error
    throw new ValidationError("Invalid account details supplied");
  }
  const destinationAccountName = String(nameInfo?.accountName || "");
  if (!destinationAccountName)
    throw new ValidationError("Unable to resolve destination account name");

  const reference = `WYMNET-PAYOUT-${randomUUID()}`;

  const amountCents = parseMoneyToCents(input.amount);
  if (amountCents <= 0n) throw new ValidationError("Amount must be positive");

  // Wallet lock + compliance + throttle + debit + payout row, all in one tx
  await db.transaction(async (tx) => {
    const locked = await lockWalletRowTx(tx, wallet.id);
    if (!locked) throw new ValidationError("Wallet not found");
    if (locked.status !== "active")
      throw new ValidationError("Wallet not active");

    const recent = await tx.execute(
      sql`select 1 from wallet_ledger where user_id = ${input.userId} and direction = 'debit' and status = 'success' and created_at >= (now() - interval '30 seconds') limit 1`,
    );
    if ((recent.rows[0] as any) !== undefined)
      throw new TooManyTransactionsError();

    await enforceNgVerificationRequirement({
      userId: input.userId,
      currencyCode: user.currencyCode,
      amount: input.amount,
      tx,
    });

    await debitWalletAtomicTx(tx, {
      walletId: wallet.id,
      userId: input.userId,
      amountCents,
      referenceCode: reference,
      transactionType: "payout",
      description: input.narration,
      relatedOrderId: reference,
    });

    const row = await tx
      .insert(payouts)
      .values({
        userId: input.userId,
        walletId: wallet.id,
        reference,
        amount: Number(input.amount).toString(),
        currencyCode: user.currencyCode,
        destinationBankCode: input.bankCode,
        destinationAccountNumber: input.accountNumber,
        destinationAccountName,
        status: "PENDING",
        provider: "monnify",
      })
      .returning();

    if (!row[0]) throw new Error("Failed to create payout");
  });

  // Enqueue after commit
  await enqueuePayout({ reference, userId: input.userId });

  return { reference };
}

export async function validateDestinationAccount(input: ValidateAccountInput) {
  try {
    const info = await monnifyNameEnquiry({
      accountNumber: input.accountNumber,
      bankCode: input.bankCode,
    });
    const accountName = String(info?.accountName || "");
    if (!accountName)
      throw new ValidationError("Unable to resolve destination account name");
    return {
      accountNumber: String(info?.accountNumber || input.accountNumber),
      accountName,
      bankCode: String(info?.bankCode || input.bankCode),
      bankName: info?.bankName ? String(info.bankName) : null,
    };
  } catch (e) {
    if (e instanceof ValidationError) throw e;
    throw new ValidationError("Invalid account details supplied");
  }
}

let cachedBanks: { name: string; code: string }[] | null = null;
let banksCachedAt = 0;
const BANKS_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function listBanks() {
  const now = Date.now();
  if (cachedBanks && now - banksCachedAt < BANKS_TTL_MS) {
    return cachedBanks;
  }

  const banks = await monnifyGetBanks();
  const normalized = banks
    .filter((b) => b?.name && b?.code)
    .map((b) => ({ name: String(b.name), code: String(b.code) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  cachedBanks = normalized;
  banksCachedAt = now;
  return normalized;
}

export async function getPayoutStatusByReference(reference: string) {
  const row = await findPayoutByReference(reference);
  if (!row) throw new ValidationError("Payout not found");
  return {
    reference: row.reference,
    status: row.status,
    providerReference: row.providerReference ?? null,
  };
}

export async function getPayoutById(id: string) {
  const row = await findPayoutById(id);
  if (!row) throw new ValidationError("Payout not found");
  return row;
}
