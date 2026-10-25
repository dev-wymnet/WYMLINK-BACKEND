import { ValidationError } from "../../../core/errors/ValidationError.js";
import { parseMoneyToCents } from "../../../core/utils/money.js";
import { db } from "../../../core/db/client.js";
import { findUserById } from "../../user/repository/user.repository.js";
import { ensureWalletForUser } from "../../wallet/service/wallet.service.js";
import {
  debitWalletAtomicTx,
  creditWalletAtomic,
} from "../../wallet/repository/wallet.repository.js";
import { peyflexBillsProvider } from "../provider/peyflex.bills.provider.js";

export async function listCableProviders() {
  return peyflexBillsProvider.listCableProviders();
}

export async function listCablePlans(identifier: string) {
  if (!identifier) throw new ValidationError("identifier is required");
  return peyflexBillsProvider.listCablePlans(identifier);
}

export async function verifyCableIUC(input: {
  identifier: string;
  iuc: string;
}) {
  if (!input.identifier || !input.iuc)
    throw new ValidationError("identifier and iuc are required");
  return peyflexBillsProvider.verifyCableIuc(input);
}

export async function subscribeCable(input: {
  userId: string;
  internalReference: string;
  identifier: string;
  plan: string;
  iuc: string;
  phone: string;
  amount?: number; // optional; Peyflex may infer
  providerName?: string; // display name for ledger description
}) {
  if (!input.internalReference || input.internalReference.length < 8)
    throw new ValidationError("internalReference is required");
  if (!input.identifier || !input.plan || !input.iuc || !input.phone)
    throw new ValidationError("identifier, plan, iuc and phone are required");

  const user = await findUserById(input.userId);
  if (!user) throw new ValidationError("User not found");

  const wallet = await ensureWalletForUser({
    userId: user.id,
    currencyCode: user.currencyCode,
  });

  // Determine debit amount: use provided amount if given, else fetch from plans
  let amountValue = input.amount ?? 0;
  if (!Number.isFinite(amountValue) || amountValue <= 0) {
    const plansResp = await peyflexBillsProvider.listCablePlans(
      input.identifier,
    );
    const plans: Array<any> = Array.isArray((plansResp as any)?.plans)
      ? (plansResp as any).plans
      : [];
    const match = plans.find((p: any) => String(p.plan_code) === input.plan);
    const parsed = Number(match?.amount ?? 0);
    if (!Number.isFinite(parsed) || parsed <= 0)
      throw new ValidationError("Unable to determine plan amount");
    amountValue = parsed;
  }
  const toDebit = parseMoneyToCents(String(amountValue));

  const txRow = await db.transaction(async (tx) => {
    // Idempotency by reference enforced at wallet ledger unique reference
    await debitWalletAtomicTx(tx, {
      walletId: wallet.id,
      userId: user.id,
      amountCents: toDebit,
      referenceCode: input.internalReference,
      transactionType: "purchase",
      description: `Cable subscription (${input.providerName ?? input.identifier})`,
      relatedOrderId: input.internalReference,
    });

    // No separate transaction row table; wallet ledger captures the movement.
    return true;
  });

  if (!txRow) throw new Error("Failed to initialize cable subscription");

  try {
    const resp = await peyflexBillsProvider.subscribeCable({
      identifier: input.identifier,
      plan: input.plan,
      iuc: input.iuc,
      phone: input.phone,
      amount: amountValue,
    });

    const status = String(resp?.status ?? "").toUpperCase();
    if (status === "SUCCESS") {
      return { status: "success", providerResponse: resp };
    }

    // Failed: refund full debited amount
    await creditWalletAtomic({
      walletId: wallet.id,
      userId: user.id,
      amountCents: toDebit,
      referenceCode: `${input.internalReference}:refund`,
      transactionType: "refund",
      description: `Refund: Cable subscription failed (${input.providerName ?? input.identifier})`,
      relatedOrderId: input.internalReference,
    });
    return { status: "failed", providerResponse: resp };
  } catch (err) {
    // On error, mark pending by leaving funds debited and allow manual reconciliation or later retry; or refund now to be safer
    await creditWalletAtomic({
      walletId: wallet.id,
      userId: user.id,
      amountCents: toDebit,
      referenceCode: `${input.internalReference}:refund`,
      transactionType: "refund",
      description: `Refund: Cable subscription error (${input.providerName ?? input.identifier})`,
      relatedOrderId: input.internalReference,
    });
    throw err;
  }
}

export async function listElectricityPlans() {
  return peyflexBillsProvider.listElectricityPlans();
}

export async function verifyElectricity(input: {
  meter: string;
  plan: string;
  type: string;
}) {
  if (!input.meter || !input.plan || !input.type)
    throw new ValidationError("meter, plan and type are required");
  return peyflexBillsProvider.verifyElectricity(input);
}

export async function subscribeElectricity(input: {
  userId: string;
  internalReference: string;
  meter: string;
  plan: string;
  amount: number;
  type: string; // prepaid|postpaid
  phone: string;
  providerName?: string | undefined; // display name for ledger description
}) {
  if (!input.internalReference || input.internalReference.length < 8)
    throw new ValidationError("internalReference is required");
  if (!input.meter || !input.plan || !input.phone || !input.type)
    throw new ValidationError("meter, plan, type and phone are required");
  if (!Number.isFinite(input.amount) || input.amount <= 0)
    throw new ValidationError("Invalid amount");

  const user = await findUserById(input.userId);
  if (!user) throw new ValidationError("User not found");

  const wallet = await ensureWalletForUser({
    userId: user.id,
    currencyCode: user.currencyCode,
  });

  const amountCents = parseMoneyToCents(String(input.amount));

  await db.transaction(async (tx) => {
    await debitWalletAtomicTx(tx, {
      walletId: wallet.id,
      userId: user.id,
      amountCents,
      referenceCode: input.internalReference,
      transactionType: "purchase",
      description: `Electricity purchase${input.providerName ? ` (${input.providerName})` : ""}`,
      relatedOrderId: input.internalReference,
    });
  });

  try {
    const resp = await peyflexBillsProvider.subscribeElectricity({
      meter: input.meter,
      plan: input.plan,
      amount: input.amount,
      type: input.type,
      phone: input.phone,
    });

    const status = String(resp?.status ?? "").toUpperCase();
    if (status === "SUCCESS") {
      return { status: "success", providerResponse: resp };
    }

    await creditWalletAtomic({
      walletId: wallet.id,
      userId: user.id,
      amountCents,
      referenceCode: `${input.internalReference}:refund`,
      transactionType: "refund",
      description: `Refund: Electricity purchase failed${input.providerName ? ` (${input.providerName})` : ""}`,
      relatedOrderId: input.internalReference,
    });
    return { status: "failed", providerResponse: resp };
  } catch (err) {
    await creditWalletAtomic({
      walletId: wallet.id,
      userId: user.id,
      amountCents,
      referenceCode: `${input.internalReference}:refund`,
      transactionType: "refund",
      description: `Refund: Electricity purchase error${input.providerName ? ` (${input.providerName})` : ""}`,
      relatedOrderId: input.internalReference,
    });
    throw err;
  }
}
