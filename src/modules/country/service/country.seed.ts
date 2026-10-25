import { db } from "../../../core/db/client.js";
import { countries } from "../../../core/db/schema.js";

export async function seedCountries(): Promise<void> {
  await db
    .insert(countries)
    .values([
      {
        code: "NG",
        name: "Nigeria",
        currencyCode: "NGN",
        enabled: true,
      },
      {
        code: "CA",
        name: "Canada",
        currencyCode: "CAD",
        enabled: true,
      },
    ])
    .onConflictDoNothing();
}
