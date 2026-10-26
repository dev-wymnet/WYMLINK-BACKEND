export type ProviderOutcome = {
  status: "success" | "failed" | "unknown";
  providerReference?: string | null;
  message?: string | null;
  raw: unknown;
  token?: string | null;
  units?: string | null;
};
