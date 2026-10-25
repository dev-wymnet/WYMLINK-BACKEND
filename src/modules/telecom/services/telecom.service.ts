import { ValidationError } from "../../../core/errors/ValidationError.js";
import { logger } from "../../../core/logger/logger.js";
import {
  centsToMoneyString,
  parseMoneyToCents,
} from "../../../core/utils/money.js";

import { db } from "../../../core/db/client.js";
import { telecomTransactions } from "../../../core/db/schema.js";
import { findUserById } from "../../user/repository/user.repository.js";
import {
  creditWalletAtomic,
  debitWalletAtomicTx,
} from "../../wallet/repository/wallet.repository.js";
import { ensureWalletForUser } from "../../wallet/service/wallet.service.js";

import {
  findTelecomTransactionByInternalReference,
  updateTelecomTransaction,
} from "../repositories/telecom.repository.js";
import { getTelecomProviderWithPlans } from "../providers/index.js";
import { eq } from "drizzle-orm";

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15)
    throw new ValidationError("Invalid phone number");
  return digits;
}

function computeNextRetry(attempts: number) {
  const baseSeconds = 30;
  const seconds = Math.min(
    60 * 15,
    baseSeconds * Math.pow(2, Math.max(0, attempts - 1)),
  );
  return new Date(Date.now() + seconds * 1000);
}

export async function telecomGetNetworks(
  providerName: "peyflex" | "reloadly" = "peyflex",
) {
  const provider = getTelecomProviderWithPlans(providerName);
  return provider.getNetworks();
}

export async function telecomGetDataPlans(input: {
  provider?: "peyflex" | "reloadly";
  network: string;
}) {
  const provider = getTelecomProviderWithPlans(input.provider ?? "peyflex");
  return provider.getDataPlans(input.network);
}

export async function purchaseAirtime(input: {
  userId: string;
  provider?: "peyflex" | "reloadly";
  internalReference: string;
  network: string;
  amount: number;
  mobileNumber: string;
}) {
  if (!input.internalReference || input.internalReference.length < 8)
    throw new ValidationError("internalReference is required");

  const user = await findUserById(input.userId);
  if (!user) throw new ValidationError("User not found");

  const wallet = await ensureWalletForUser({
    userId: user.id,
    currencyCode: user.currencyCode,
  });

  const mobileNumber = normalizePhone(input.mobileNumber);
  if (!input.network) throw new ValidationError("network is required");
  if (!Number.isFinite(input.amount) || input.amount <= 0)
    throw new ValidationError("Invalid amount");

  const amountCents = parseMoneyToCents(String(input.amount));
  if (amountCents <= 0n) throw new ValidationError("Invalid amount");

  let providerName: "peyflex" | "reloadly" = "peyflex";
  if (user.countryCode === "CA") providerName = "reloadly";
  else if (user.countryCode === "NG" && (user as any).telecomReloadlyEnabled)
    providerName = "reloadly";
  else if (input.provider) providerName = input.provider;

  const txRow = await db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(telecomTransactions)
      .where(eq(telecomTransactions.internalReference, input.internalReference))
      .limit(1);

    if (existing[0]) return existing[0];

    await debitWalletAtomicTx(tx, {
      walletId: wallet.id,
      userId: user.id,
      amountCents,
      referenceCode: input.internalReference,
      transactionType: "purchase",
      description: `Airtime purchase (${providerName})`,
      relatedOrderId: input.internalReference,
    });

    const created = await tx
      .insert(telecomTransactions)
      .values({
        userId: user.id,
        walletId: wallet.id,
        internalReference: input.internalReference,
        provider: providerName,
        providerReference: null,
        productType: "airtime",
        network: input.network,
        mobileNumber,
        planCode: null,
        amount: centsToMoneyString(amountCents),
        status: "pending",
        requestPayload: {
          type: "airtime",
          provider: providerName,
          network: input.network,
          amount: input.amount,
          mobileNumber,
        } as any,
        providerResponse: null,
        lastError: null,
      })
      .returning();

    return created[0] ?? null;
  });

  if (!txRow) throw new Error("Failed to create telecom transaction");

  const provider = getTelecomProviderWithPlans(providerName);

  try {
    const resp = await provider.purchaseAirtime({
      network: input.network,
      amount: input.amount,
      mobileNumber,
    });

    if (resp.status === "SUCCESS") {
      return await updateTelecomTransaction({
        internalReference: input.internalReference,
        status: "success",
        providerReference: resp.providerReference ?? null,
        providerResponse: resp.raw,
        lastError: null,
        nextRetryAt: null,
      });
    }

    if (resp.status === "FAILED") {
      await creditWalletAtomic({
        walletId: wallet.id,
        userId: user.id,
        amountCents,
        referenceCode: `${input.internalReference}:refund`,
        transactionType: "refund",
        description: `Refund: Airtime purchase failed (${providerName})`,
        relatedOrderId: input.internalReference,
      });

      return await updateTelecomTransaction({
        internalReference: input.internalReference,
        status: "failed",
        providerReference: resp.providerReference ?? null,
        providerResponse: resp.raw,
        lastError: resp.message ?? "Provider failed",
        nextRetryAt: null,
      });
    }

    const nextRetryAt = computeNextRetry(Number(txRow.attempts ?? 0) + 1);
    return await updateTelecomTransaction({
      internalReference: input.internalReference,
      status: "pending",
      providerReference: resp.providerReference ?? null,
      providerResponse: resp.raw,
      lastError: resp.message ?? "Provider pending",
      nextRetryAt,
      attemptsIncrement: 1,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    const nextRetryAt = computeNextRetry(Number(txRow.attempts ?? 0) + 1);
    logger.warn(
      { internalReference: input.internalReference, err },
      "telecom_airtime_provider_error",
    );

    return await updateTelecomTransaction({
      internalReference: input.internalReference,
      status: "pending",
      providerReference: null,
      providerResponse: null,
      lastError: message,
      nextRetryAt,
      attemptsIncrement: 1,
    });
  }
}

export async function purchaseData(input: {
  userId: string;
  provider?: "peyflex" | "reloadly";
  internalReference: string;
  network: string;
  planCode: string;
  mobileNumber: string;
}) {
  if (!input.internalReference || input.internalReference.length < 8)
    throw new ValidationError("internalReference is required");

  const user = await findUserById(input.userId);
  if (!user) throw new ValidationError("User not found");

  const wallet = await ensureWalletForUser({
    userId: user.id,
    currencyCode: user.currencyCode,
  });

  const mobileNumber = normalizePhone(input.mobileNumber);
  if (!input.network) throw new ValidationError("network is required");
  if (!input.planCode) throw new ValidationError("planCode is required");

  let providerName: "peyflex" | "reloadly" = "peyflex";
  if (user.countryCode === "CA") providerName = "reloadly";
  else if (user.countryCode === "NG" && (user as any).telecomReloadlyEnabled)
    providerName = "reloadly";
  else if (input.provider) providerName = input.provider;
  const provider = getTelecomProviderWithPlans(providerName);

  const plansResp = await provider.getDataPlans(input.network);
  const plans = (plansResp as any)?.plans as Array<any> | undefined;
  const match = plans?.find(
    (p) => String(p.plan_code ?? p.planCode) === input.planCode,
  );
  if (!match) throw new ValidationError("Invalid planCode for network");

  const planAmount = Number(match.amount);
  if (!Number.isFinite(planAmount) || planAmount <= 0)
    throw new ValidationError("Invalid plan amount");

  const amountCents = parseMoneyToCents(String(planAmount));

  const txRow = await db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(telecomTransactions)
      .where(eq(telecomTransactions.internalReference, input.internalReference))
      .limit(1);

    if (existing[0]) return existing[0];

    await debitWalletAtomicTx(tx, {
      walletId: wallet.id,
      userId: user.id,
      amountCents,
      referenceCode: input.internalReference,
      transactionType: "purchase",
      description: `Data purchase (${providerName})`,
      relatedOrderId: input.internalReference,
    });

    const created = await tx
      .insert(telecomTransactions)
      .values({
        userId: user.id,
        walletId: wallet.id,
        internalReference: input.internalReference,
        provider: providerName,
        providerReference: null,
        productType: "data",
        network: input.network,
        mobileNumber,
        planCode: input.planCode,
        amount: centsToMoneyString(amountCents),
        status: "pending",
        requestPayload: {
          type: "data",
          provider: providerName,
          network: input.network,
          planCode: input.planCode,
          mobileNumber,
          amount: planAmount,
        } as any,
        providerResponse: null,
        lastError: null,
      })
      .returning();

    return created[0] ?? null;
  });

  if (!txRow) throw new Error("Failed to create telecom transaction");

  try {
    const resp = await provider.purchaseData({
      network: input.network,
      mobileNumber,
      planCode: input.planCode,
    });

    if (resp.status === "SUCCESS") {
      return await updateTelecomTransaction({
        internalReference: input.internalReference,
        status: "success",
        providerReference: resp.providerReference ?? null,
        providerResponse: resp.raw,
        lastError: null,
        nextRetryAt: null,
      });
    }

    if (resp.status === "FAILED") {
      await creditWalletAtomic({
        walletId: wallet.id,
        userId: user.id,
        amountCents,
        referenceCode: `${input.internalReference}:refund`,
        transactionType: "refund",
        description: `Refund: Data purchase failed (${providerName})`,
        relatedOrderId: input.internalReference,
      });

      return await updateTelecomTransaction({
        internalReference: input.internalReference,
        status: "failed",
        providerReference: resp.providerReference ?? null,
        providerResponse: resp.raw,
        lastError: resp.message ?? "Provider failed",
        nextRetryAt: null,
      });
    }

    const nextRetryAt = computeNextRetry(Number(txRow.attempts ?? 0) + 1);
    return await updateTelecomTransaction({
      internalReference: input.internalReference,
      status: "pending",
      providerReference: resp.providerReference ?? null,
      providerResponse: resp.raw,
      lastError: resp.message ?? "Provider pending",
      nextRetryAt,
      attemptsIncrement: 1,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    const nextRetryAt = computeNextRetry(Number(txRow.attempts ?? 0) + 1);
    logger.warn(
      { internalReference: input.internalReference, err },
      "telecom_data_provider_error",
    );

    return await updateTelecomTransaction({
      internalReference: input.internalReference,
      status: "pending",
      providerReference: null,
      providerResponse: null,
      lastError: message,
      nextRetryAt,
      attemptsIncrement: 1,
    });
  }
}
