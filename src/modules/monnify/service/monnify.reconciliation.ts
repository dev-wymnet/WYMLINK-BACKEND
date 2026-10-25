import { ValidationError } from '../../../core/errors/ValidationError.js';
import { logger } from '../../../core/logger/logger.js';

import { findUserById } from '../../user/repository/user.repository.js';
import { findWalletByUserCurrency, listLedgerByWallet } from '../../wallet/repository/wallet.repository.js';
import { monnifySearchTransactions } from '../client/monnify.client.js';
import { findReservedAccountByWalletId } from '../repository/monnify.repository.js';

type MonnifyTransactionItem = {
  transactionReference?: string;
  paymentReference?: string;
  amountPaid?: string;
  paymentStatus?: string;
  accountNumber?: string;
};

function normalizeTransactionList(responseBody: unknown): MonnifyTransactionItem[] {
  if (Array.isArray(responseBody)) return responseBody as MonnifyTransactionItem[];
  if (!responseBody || typeof responseBody !== 'object') return [];

  const body = responseBody as Record<string, unknown>;
  if (Array.isArray(body.content)) return body.content as MonnifyTransactionItem[];
  if (Array.isArray(body.data)) return body.data as MonnifyTransactionItem[];
  if (Array.isArray(body.items)) return body.items as MonnifyTransactionItem[];
  return [];
}

export async function reconcileWalletFundingTransactions(userId: string) {
  const user = await findUserById(userId);
  if (!user) throw new ValidationError('User not found');

  const wallet = await findWalletByUserCurrency({ userId, currencyCode: user.currencyCode });
  if (!wallet) throw new ValidationError('Wallet not found');

  const reserved = await findReservedAccountByWalletId(wallet.id);
  if (!reserved?.accountNumber) throw new ValidationError('Reserved account not found');

  const ledger = await listLedgerByWallet({ walletId: wallet.id, limit: 500 });
  const fundingLedger = ledger.filter((entry) => entry.transactionType === 'funding');

  const externalResponse = await monnifySearchTransactions({
    accountNumber: reserved.accountNumber,
  });
  const externalTransactions = normalizeTransactionList(externalResponse).filter(
    (item) => item.paymentStatus === 'PAID',
  );

  const internalByReference = new Map(
    fundingLedger.map((entry) => [entry.referenceCode, entry]),
  );
  const externalByReference = new Map(
    externalTransactions
      .filter((item) => item.transactionReference)
      .map((item) => [item.transactionReference as string, item]),
  );

  const missingInLedger = externalTransactions
    .filter((item) => item.transactionReference && !internalByReference.has(item.transactionReference))
    .map((item) => ({
      transactionReference: item.transactionReference,
      paymentReference: item.paymentReference,
      amountPaid: item.amountPaid,
    }));

  const missingInMonnify = fundingLedger
    .filter((entry) => !externalByReference.has(entry.referenceCode))
    .map((entry) => ({
      referenceCode: entry.referenceCode,
      relatedOrderId: entry.relatedOrderId,
      amount: entry.amount,
    }));

  const amountMismatches = externalTransactions
    .filter((item) => item.transactionReference && internalByReference.has(item.transactionReference))
    .flatMap((item) => {
      const ledgerEntry = internalByReference.get(item.transactionReference as string);
      if (!ledgerEntry) return [];
      if (!item.amountPaid || ledgerEntry.amount === item.amountPaid) return [];
      return [
        {
          transactionReference: item.transactionReference,
          ledgerAmount: ledgerEntry.amount,
          monnifyAmount: item.amountPaid,
        },
      ];
    });

  const result = {
    walletId: wallet.id,
    accountNumber: reserved.accountNumber,
    totals: {
      ledgerFundingCount: fundingLedger.length,
      monnifyPaidCount: externalTransactions.length,
      missingInLedgerCount: missingInLedger.length,
      missingInMonnifyCount: missingInMonnify.length,
      amountMismatchCount: amountMismatches.length,
    },
    missingInLedger,
    missingInMonnify,
    amountMismatches,
  };

  logger.info({ userId, walletId: wallet.id, result }, 'monnify_reconciliation_completed');

  return result;
}
