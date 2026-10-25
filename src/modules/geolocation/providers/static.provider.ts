import type {
  GeolocationProvider,
  RegionResolution,
} from "./provider.interface.js";

const COMPLIANCE_REGION_BY_COUNTRY: Record<string, string> = {
  CA: "FINTRAC",
  US: "FINCEN",
  AE: "UAE",
  NG: "CBN",
};

export class StaticGeolocationProvider implements GeolocationProvider {
  async resolve(_ip: string | null): Promise<RegionResolution | null> {
    return null;
  }

  static fromCountry(input: {
    countryCode: string;
    countryName: string;
    region?: string | null;
    preferredCurrency: string;
  }): RegionResolution {
    return {
      countryCode: input.countryCode,
      countryName: input.countryName,
      region: input.region ?? "",
      preferredCurrency: input.preferredCurrency,
      complianceRegion:
        COMPLIANCE_REGION_BY_COUNTRY[input.countryCode.toUpperCase()] ??
        "UNKNOWN",
    };
  }
}
