import { db } from "../../../core/db/client.js";
import { complianceFlags } from "../../../core/db/schema.js";
import { FintracComplianceProvider } from "../providers/fintrac.provider.js";
import type { ComplianceProvider } from "../providers/provider.interface.js";

const COMPLIANCE_PROVIDERS: Record<string, ComplianceProvider> = {
  FINTRAC: new FintracComplianceProvider(),
};

export async function checkTransactionCompliance(input: {
  userId: string;
  currencyCode: string;
  amount: string;
  direction: "credit" | "debit";
  complianceRegion?: string | null;
  walletLedgerId: string;
}) {
  const region = input.complianceRegion?.toUpperCase() || "UNKNOWN";
  const provider = COMPLIANCE_PROVIDERS[region];

  if (!provider) {
    return { compliant: true, ruleCode: "no_provider" };
  }

  const result = await provider.checkTransaction({
    userId: input.userId,
    currencyCode: input.currencyCode,
    amount: input.amount,
    direction: input.direction,
  });

  if (!result.compliant) {
    await db.insert(complianceFlags).values({
      userId: input.userId,
      walletLedgerId: input.walletLedgerId,
      complianceRegion: region,
      ruleCode: result.ruleCode,
      status: "flagged",
      metadata: result.metadata as any,
    });
  }

  return result;
}
