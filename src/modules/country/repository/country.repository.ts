import { and, eq } from 'drizzle-orm';

import { db } from '../../../core/db/client.js';
import { countries } from '../../../core/db/schema.js';

export async function findEnabledCountryByCode(code: string) {
  const rows = await db
    .select()
    .from(countries)
    .where(and(eq(countries.code, code), eq(countries.enabled, true)))
    .limit(1);

  return rows[0] ?? null;
}
