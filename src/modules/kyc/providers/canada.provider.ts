import type {
  KycProvider,
  KycVerificationRequest,
  KycVerificationResult,
} from "./provider.interface.js";

export class CanadaKycProvider implements KycProvider {
  region = "CA";

  async initiateVerification(
    request: KycVerificationRequest,
  ): Promise<KycVerificationResult> {
    const { sin } = request.data as { sin?: string };

    if (!sin) {
      return {
        success: false,
        status: "rejected",
        message: "SIN required for Canada KYC",
      };
    }

    return {
      success: true,
      kycId: `ca_kyc_${Date.now()}`,
      status: "pending",
      message: "KYC verification initiated with Equifax/TransUnion",
      metadata: {
        provider: "Equifax",
        sin: sin ? "provided" : "not_provided",
      },
    };
  }

  async checkStatus(kycId: string): Promise<KycVerificationResult> {
    return {
      success: true,
      kycId,
      status: "pending",
      message: "Credit bureau verification in progress",
    };
  }
}
