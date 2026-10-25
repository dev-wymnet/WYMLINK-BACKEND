export type AirtimePayload = {
  network: string;
  amount: number;
  mobileNumber: string;
};

export type DataPayload = {
  network: string;
  mobileNumber: string;
  planCode: string;
};

export type ProviderResponse = {
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  providerReference?: string;
  message?: string;
  raw: unknown;
  amount?: string;
};

export interface TelecomProvider {
  getNetworks(): Promise<any>;
  purchaseAirtime(payload: AirtimePayload): Promise<ProviderResponse>;
  purchaseData(payload: DataPayload): Promise<ProviderResponse>;
}

export type TelecomProviderWithPlans = TelecomProvider & {
  getDataPlans(network: string): Promise<any>;
};
