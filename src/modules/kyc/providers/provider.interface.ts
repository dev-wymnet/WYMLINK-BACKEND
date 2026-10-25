export type KycVerificationRequest = {
  userId: string;
  countryCode: string;
  region?: string | null;
  data: Record<string, unknown>;
};

export type KycVerificationResult = {
  success: boolean;
  kycId?: string;
  status: "pending" | "approved" | "rejected" | "review_required";
  message?: string;
  metadata?: Record<string, unknown>;
};

export interface KycProvider {
  region: string;
  initiateVerification(request: KycVerificationRequest): Promise<KycVerificationResult>;
  checkStatus(kycId: string): Promise<KycVerificationResult>;
}
