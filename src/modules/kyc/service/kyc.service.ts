import type { KycProvider, KycVerificationRequest, KycVerificationResult } from "../providers/provider.interface.js";

const kycProviders = new Map<string, KycProvider>();

export function registerKycProvider(provider: KycProvider) {
  kycProviders.set(provider.region.toLowerCase(), provider);
}

export function getKycProvider(region: string): KycProvider | undefined {
  return kycProviders.get(region.toLowerCase());
}

export async function initiateKycVerification(request: KycVerificationRequest): Promise<KycVerificationResult> {
  const provider = getKycProvider(request.countryCode);
  
  if (!provider) {
    return {
      success: false,
      status: "rejected",
      message: `No KYC provider configured for region: ${request.countryCode}`,
    };
  }

  return provider.initiateVerification(request);
}

export async function checkKycStatus(region: string, kycId: string): Promise<KycVerificationResult> {
  const provider = getKycProvider(region);
  
  if (!provider) {
    return {
      success: false,
      status: "rejected",
      message: `No KYC provider configured for region: ${region}`,
    };
  }

  return provider.checkStatus(kycId);
}
