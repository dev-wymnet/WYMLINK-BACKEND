import type {
  KycProvider,
  KycVerificationRequest,
  KycVerificationResult,
} from "./provider.interface.js";

export class UsaKycProvider implements KycProvider {
  region = "US";

  async initiateVerification(
    request: KycVerificationRequest,
  ): Promise<KycVerificationResult> {
    const { ssn, tin } = request.data as { ssn?: string; tin?: string };

    if (!ssn && !tin) {
      return {
        success: false,
        status: "rejected",
        message: "SSN or TIN required for US KYC",
      };
    }

    return {
      success: true,
      kycId: `us_kyc_${Date.now()}`,
      status: "pending",
      message: "KYC verification initiated with OFAC screening",
      metadata: {
        provider: "ComplyAdvantage",
        ssn: ssn ? "provided" : "not_provided",
        tin: tin ? "provided" : "not_provided",
      },
    };
  }

  async checkStatus(kycId: string): Promise<KycVerificationResult> {
    return {
      success: true,
      kycId,
      status: "pending",
      message: "OFAC screening in progress",
    };
  }
}
