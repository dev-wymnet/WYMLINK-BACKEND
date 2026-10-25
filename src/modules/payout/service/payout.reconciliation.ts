import { and, eq } from "drizzle-orm";

import { db } from "../../../core/db/client.js";
import { payouts } from "../../../core/db/schema.js";
import { monnifyGetSingleDisbursementSummary } from "../../monnify/client/monnify.client.js";
import { updatePayoutStatusAtomic } from "../repository/payout.repository.js";

export async function reconcileUserPayouts(userId: string, limit = 50) {
  const rows = await db
    .select()
    .from(payouts)
    .where(and(eq(payouts.userId, userId), eq(payouts.status, "PROCESSING")))
    .limit(limit);

  const results: Array<{ reference: string; from: string; to?: string | null }> = [];

  for (const p of rows) {
    try {
      const summary = await monnifyGetSingleDisbursementSummary(p.reference);
      const body = (summary as any)?.responseBody ?? {};
      const status = body.status ?? body.transactionStatus;

      if (!status) continue;

      if (status === "SUCCESS" || status === "COMPLETED") {
        await updatePayoutStatusAtomic({ id: p.id, fromStatuses: ["PROCESSING"], toStatus: "SUCCESS", providerReference: body.transactionReference ?? null });
        results.push({ reference: p.reference, from: p.status, to: "SUCCESS" });
      } else if (status === "FAILED" || status === "REVERSED" || status === "EXPIRED") {
        await updatePayoutStatusAtomic({ id: p.id, fromStatuses: ["PROCESSING"], toStatus: status, providerReference: body.transactionReference ?? null });
        results.push({ reference: p.reference, from: p.status, to: status });
      } else {
        results.push({ reference: p.reference, from: p.status, to: null });
      }
    } catch {
      results.push({ reference: p.reference, from: p.status, to: null });
    }
  }

  return { reconciled: results };
}
