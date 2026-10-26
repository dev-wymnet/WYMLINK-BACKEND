import { NotFoundError } from "../../../core/errors/NotFoundError.js";
import { waitForNewDeposits } from "../../banking/account.service.js";
import {
  findActiveVirtualAccount,
  findLedgerByIdForUser,
  getOrCreateWallet,
  listLedgerByWallet,
  type LedgerEntry,
} from "../repository/wallet.repository.js";

// API shape of a ledger line (kept stable for the web and mobile apps).
// Ledger lines are final, so status is always "success".
export function toLedgerDto(e: LedgerEntry) {
  return {
    id: e.id,
    transactionType: e.entryType,
    direction: e.direction,
    amount: e.amount,
    balanceBefore: e.balanceBefore,
    balanceAfter: e.balanceAfter,
    referenceCode: e.reference,
    relatedType: e.relatedType,
    relatedId: e.relatedId,
    description: e.description,
    status: "success",
    createdAt: e.createdAt,
  };
}

// Reading the wallet also picks up new deposits (see refreshDepositsFromMoneta).
export async function getWalletDetails(userId: string) {
  let wallet = await getOrCreateWallet(userId);
  const virtualAccount = await findActiveVirtualAccount(wallet.id);
  if (virtualAccount) {
    await waitForNewDeposits(virtualAccount);
    wallet = await getOrCreateWallet(userId);
  }
  return { wallet, virtualAccount };
}

export async function listMyTransactions(userId: string, limit: number) {
  const wallet = await getOrCreateWallet(userId);
  const rows = await listLedgerByWallet(wallet.id, limit);
  return rows.map(toLedgerDto);
}

export async function getMyTransaction(userId: string, id: string) {
  const row = await findLedgerByIdForUser(id, userId);
  if (!row) throw new NotFoundError("Transaction not found");
  return toLedgerDto(row);
}
