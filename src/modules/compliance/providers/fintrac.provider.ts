import type { ComplianceProvider, ComplianceCheckResult } from "./provider.interface.js";

const FINTRAC_LARGE_TRANSACTION_THRESHOLD_CAD = 10000;

export class FintracComplianceProvider implements ComplianceProvider {
  async checkTransaction(input: {
    userId: string;
    currencyCode: string;
    amount: string;
    direction: "credit" | "debit";
  }): Promise<ComplianceCheckResult> {
    if (input.currencyCode.toUpperCase() !== "CAD") {
      return { compliant: true, ruleCode: "fintrac_non_cad" };
    }

    const amount = Number(input.amount);
    if (isNaN(amount)) {
      return { compliant: true, ruleCode: "fintrac_invalid_amount" };
    }

    if (input.direction === "credit" && amount >= FINTRAC_LARGE_TRANSACTION_THRESHOLD_CAD) {
      return {
        compliant: false,
        ruleCode: "fintrac_lctr_threshold",
        message: "Transaction exceeds CAD 10,000 large cash transaction reporting threshold",
        metadata: {
          amount: input.amount,
          threshold: FINTRAC_LARGE_TRANSACTION_THRESHOLD_CAD,
        },
      };
    }

    return { compliant: true, ruleCode: "fintrac_below_threshold" };
  }
}
