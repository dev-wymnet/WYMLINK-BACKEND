export type ComplianceCheckResult = {
  compliant: boolean;
  ruleCode: string;
  message?: string;
  metadata?: Record<string, unknown>;
};

export interface ComplianceProvider {
  checkTransaction(input: {
    userId: string;
    currencyCode: string;
    amount: string;
    direction: "credit" | "debit";
  }): Promise<ComplianceCheckResult>;
}
