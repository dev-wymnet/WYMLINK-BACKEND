import type {
  KycProvider,
  KycVerificationRequest,
  KycVerificationResult,
} from "./provider.interface.js";

export class NigeriaKycProvider implements KycProvider {
  region = "NG";

  async initiateVerification(
    request: KycVerificationRequest,
  ): Promise<KycVerificationResult> {
    const { bvn, nin } = request.data as { bvn?: string; nin?: string };

    if (!bvn && !nin) {
      return {
        success: false,
        status: "rejected",
        message: "BVN or NIN required for Nigeria KYC",
      };
    }

    return {
      success: true,
      kycId: `ng_kyc_${Date.now()}`,
      status: "pending",
      message: "KYC verification initiated with NIMC",
      metadata: {
        provider: "NIMC",
        bvn: bvn ? "provided" : "not_provided",
        nin: nin ? "provided" : "not_provided",
      },
    };
  }

  async checkStatus(kycId: string): Promise<KycVerificationResult> {
    return {
      success: true,
      kycId,
      status: "pending",
      message: "Verification in progress",
    };
  }
}
