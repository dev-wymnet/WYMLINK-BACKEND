import type {
  TelecomProvider,
  TelecomProviderWithPlans,
} from "./provider.interface.js";
import { peyflexProvider } from "./peyflex.provider.js";
import { reloadlyProvider } from "./reloadly.provider.js";

export type TelecomProviderName = "peyflex" | "reloadly";

export function getTelecomProvider(name: TelecomProviderName): TelecomProvider {
  if (name === "reloadly") return reloadlyProvider;
  if (name === "peyflex") return peyflexProvider;
  return peyflexProvider;
}

export function getTelecomProviderWithPlans(
  name: TelecomProviderName,
): TelecomProviderWithPlans {
  const provider = getTelecomProvider(name);
  return provider as TelecomProviderWithPlans;
}
