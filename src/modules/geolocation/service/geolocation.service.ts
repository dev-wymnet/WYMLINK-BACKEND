import { findEnabledCountryByCode } from "../../country/repository/country.repository.js";
import { getGeolocationProvider } from "../providers/index.js";
import { StaticGeolocationProvider } from "../providers/static.provider.js";

export async function resolveRegionForCountry(input: { countryCode: string }) {
  const country = await findEnabledCountryByCode(input.countryCode);
  if (!country) return null;

  return StaticGeolocationProvider.fromCountry({
    countryCode: country.code,
    countryName: country.name,
    preferredCurrency: country.currencyCode,
  });
}

export async function resolveRegionForRequest(input: {
  ip: string | null;
  fallbackCountryCode?: string;
}) {
  const provider = getGeolocationProvider();
  const byIp = await provider.resolve(input.ip);
  if (byIp) return byIp;

  if (input.fallbackCountryCode)
    return resolveRegionForCountry({ countryCode: input.fallbackCountryCode });

  return null;
}
