export type RegionResolution = {
  countryCode: string;
  countryName: string;
  region: string;
  preferredCurrency: string;
  complianceRegion: string;
};

export interface GeolocationProvider {
  resolve(ip: string | null): Promise<RegionResolution | null>;
}
