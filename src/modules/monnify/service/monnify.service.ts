import { env } from "../../../core/config/env.js";
import { ValidationError } from "../../../core/errors/ValidationError.js";
import { logger } from "../../../core/logger/logger.js";
import { randomToken } from "../../../core/utils/crypto.js";

import { monnifyCreateReservedAccount } from "../client/monnify.client.js";
import {
  findReservedAccountByWalletId,
  insertReservedAccount,
} from "../repository/monnify.repository.js";

export async function monnifyEnsureReservedAccountForWallet(input: {
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    currencyCode: string;
  };
  wallet: { id: string; userId: string; currencyCode: string };
}) {
  const existing = await findReservedAccountByWalletId(input.wallet.id);
  if (existing) return existing;

  const email = input.user.email;
  if (!email) {
    throw new ValidationError(
      "Customer email is required to create Monnify reserved account",
    );
  }

  const accountReference = `wal_${input.wallet.id}_${randomToken(8)}`;
  const accountName = `${input.user.firstName} ${input.user.lastName}`.trim();

  let resp: Awaited<ReturnType<typeof monnifyCreateReservedAccount>>;

  try {
    resp = await monnifyCreateReservedAccount({
      accountReference,
      accountName,
      currencyCode: input.wallet.currencyCode,
      contractCode: env.MONNIFY_CONTRACT_CODE,
      customerEmail: email,
      getAllAvailableBanks: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (
      message.includes('"responseCode":"R42"') ||
      message.includes(
        "You cannot reserve more than 1 account(s) for a customer",
      )
    ) {
      throw new ValidationError(
        "Monnify already has a reserved account for this customer email. Use a different email or reuse the existing customer/account in Monnify sandbox.",
      );
    }

    throw error;
  }

  const body = (resp as any).responseBody ?? {};
  const accounts = (body.accounts ?? []) as Array<any>;
  const firstAccount = accounts[0] ?? {};

  const inserted = await insertReservedAccount({
    userId: input.user.id,
    walletId: input.wallet.id,
    accountReference,
    reservationReference: body.reservationReference ?? null,
    status: body.status ?? null,
    bankCode: firstAccount.bankCode ?? null,
    bankName: firstAccount.bankName ?? null,
    accountNumber: firstAccount.accountNumber ?? null,
    accountName: firstAccount.accountName ?? accountName ?? null,
    rawResponse: resp,
  });

  if (!inserted) throw new Error("Failed to persist reserved account");

  logger.info(
    { userId: input.user.id, walletId: input.wallet.id, accountReference },
    "monnify_reserved_account_created",
  );

  return inserted;
}
