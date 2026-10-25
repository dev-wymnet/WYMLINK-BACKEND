import { StaticGeolocationProvider } from "./static.provider.js";

export function getGeolocationProvider() {
  return new StaticGeolocationProvider();
}
