import { ValidationError } from "../../../core/errors/ValidationError.js";
import { TooManyTransactionsError } from "../../../core/errors/AppError.js";
import { sql } from "drizzle-orm";
import { logger } from "../../../core/logger/logger.js";
import { parseMoneyToCents } from "../../../core/utils/money.js";

import { findUserById } from "../../user/repository/user.repository.js";
import { monnifyEnsureReservedAccountForWallet } from "../../monnify/service/monnify.service.js";
import {
  createWalletRow,
  debitWalletAtomicTx,
  findWalletByUserCurrency,
  listLedgerByWallet,
  findLedgerByIdForUser,
  findLedgerByReference,
  lockWalletRowTx,
} from "../repository/wallet.repository.js";
import { checkTransactionCompliance } from "../../compliance/service/compliance.service.js";
import { enforceTransactionLimit } from "../../compliance/service/transactionLimits.service.js";
import { db } from "../../../core/db/client.js";
import { enforceNgVerificationRequirement } from "../../compliance/service/ngVerification.service.js";
import { NotFoundError } from "../../../core/errors/NotFoundError.js";

export async function ensureWalletForUser(input: {
  userId: string;
  currencyCode: string;
}) {
  const existing = await findWalletByUserCurrency({
    userId: input.userId,
    currencyCode: input.currencyCode,
  });
  if (existing) return existing;

  const created = await createWalletRow({
    userId: input.userId,
    currencyCode: input.currencyCode,
  });
  if (!created) {
    const again = await findWalletByUserCurrency({
      userId: input.userId,
      currencyCode: input.currencyCode,
    });
    if (!again) throw new Error("Failed to create wallet");
    return again;
  }

  logger.info(
    {
      userId: input.userId,
      currencyCode: input.currencyCode,
      walletId: created.id,
    },
    "wallet_created",
  );
  return created;
}

export async function createWalletAndReservedAccount(input: {
  userId: string;
  currencyCode: string;
}) {
  const user = await findUserById(input.userId);
  if (!user) throw new ValidationError("User not found");

  const wallet = await ensureWalletForUser({
    userId: input.userId,
    currencyCode: input.currencyCode,
  });
  // Monnify is NG-only. For non-NG users (e.g., CA), skip creating a reserved account.
  const reserved =
    user.countryCode === "NG"
      ? await monnifyEnsureReservedAccountForWallet({ user, wallet })
      : null;

  return { wallet, reserved };
}

export async function getWalletDetails(userId: string) {
  const user = await findUserById(userId);
  if (!user) throw new ValidationError("User not found");

  const wallet = await ensureWalletForUser({
    userId,
    currencyCode: user.currencyCode,
  });
  const reserved =
    user.countryCode === "NG"
      ? await monnifyEnsureReservedAccountForWallet({ user, wallet })
      : null;

  return {
    wallet,
    reserved,
  };
}

export async function listMyTransactions(userId: string, limit: number) {
  const user = await findUserById(userId);
  if (!user) throw new ValidationError("User not found");

  const wallet = await ensureWalletForUser({
    userId,
    currencyCode: user.currencyCode,
  });
  return listLedgerByWallet({ walletId: wallet.id, limit });
}

export async function getMyTransaction(userId: string, id: string) {
  const row = await findLedgerByIdForUser({ id, userId });
  if (!row) throw new NotFoundError("Transaction not found");
  return row;
}

export async function debitMyWallet(input: {
  userId: string;
  amount: string;
  reference: string;
  description: string;
}) {
  const user = await findUserById(input.userId);
  if (!user) throw new ValidationError("User not found");

  await enforceTransactionLimit({
    userId: input.userId,
    currencyCode: user.currencyCode,
    amount: input.amount,
    complianceRegion: user.complianceRegion,
    complianceTier: user.complianceTier,
  });

  const wallet = await ensureWalletForUser({
    userId: input.userId,
    currencyCode: user.currencyCode,
  });

  const amountCents = parseMoneyToCents(input.amount);
  if (amountCents <= 0n) throw new ValidationError("Amount must be positive");

  const result = await db.transaction(async (tx) => {
    const locked = await lockWalletRowTx(tx, wallet.id);
    if (!locked) throw new ValidationError("Wallet not found");
    if (locked.status !== "active")
      throw new ValidationError("Wallet not active");

    const recent = await tx.execute(
      sql`select 1 from wallet_ledger where user_id = ${input.userId} and direction = 'debit' and status = 'success' and created_at >= (now() - interval '30 seconds') limit 1`,
    );
    if ((recent.rows[0] as any) !== undefined) {
      throw new TooManyTransactionsError();
    }

    // NG verification daily limit enforcement within same tx
    await enforceNgVerificationRequirement({
      userId: input.userId,
      currencyCode: user.currencyCode,
      amount: input.amount,
      tx,
    });

    const debited = await debitWalletAtomicTx(tx, {
      walletId: wallet.id,
      userId: input.userId,
      amountCents,
      referenceCode: input.reference,
      transactionType: "purchase",
      description: input.description,
      relatedOrderId: input.reference,
    });

    return debited;
  });

  logger.info(
    {
      userId: input.userId,
      walletId: wallet.id,
      reference: input.reference,
      idempotent: result.idempotent,
    },
    "wallet_debit",
  );

  return result;
}

async function runComplianceCheckAfterCredit(input: {
  userId: string;
  currencyCode: string;
  amount: string;
  referenceCode: string;
}) {
  const user = await findUserById(input.userId);
  if (!user) return;

  const ledger = await findLedgerByReference(input.referenceCode);
  if (!ledger) return;

  await checkTransactionCompliance({
    userId: input.userId,
    currencyCode: input.currencyCode,
    amount: input.amount,
    direction: "credit",
    complianceRegion: user.complianceRegion,
    walletLedgerId: ledger.id,
  });
}

export { runComplianceCheckAfterCredit };
