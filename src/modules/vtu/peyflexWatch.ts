import { env } from "../../core/config/env.js";
import { logger } from "../../core/logger/logger.js";
import { claimOnce, emailTeam, nairaText } from "../admin/alerts/opsAlerts.js";

// Warns the team when WymNet's Peyflex balance runs low, before customers' purchases start
// failing. Peyflex reports its balance after every purchase, and a refusal for an
// "insufficient balance" means it has already run out. At most one email of each kind
// every 6 hours.
const EVERY_MS = 6 * 3600_000;

export function watchPeyflexBalance(provider: string, outcome: { status: string; message?: string | null; raw?: unknown }) {
  if (provider !== "peyflex" || env.PEYFLEX_LOW_BALANCE <= 0) return;
  const raw = outcome.raw as { balance?: unknown; wallet_balance?: unknown } | null | undefined;
  const reported = Number(raw?.balance ?? raw?.wallet_balance ?? NaN);
  const balance = Number.isFinite(reported) ? reported : null;
  const ranOut = outcome.status === "failed" && /insufficient/i.test(outcome.message ?? "");
  if (!ranOut && (balance === null || balance >= env.PEYFLEX_LOW_BALANCE)) return;

  void (async () => {
    // "Ran out" is its own alert, so it still goes out after a recent "low" warning.
    if (!(await claimOnce(ranOut ? "PEYFLEX_EMPTY_ALERT" : "PEYFLEX_LOW_BALANCE_ALERT", new Date(Date.now() - EVERY_MS), { balance, ranOut }))) return;
    const level = nairaText(env.PEYFLEX_LOW_BALANCE);
    await emailTeam(
      ranOut ? "Wymlink: the Peyflex balance has run out, purchases are failing" : `Wymlink: the Peyflex balance is low (${nairaText(balance!)})`,
      [
        ranOut
          ? "Peyflex just refused a customer's purchase because WymNet's Peyflex balance is too low."
          : `WymNet's Peyflex balance is ${nairaText(balance!)}, below the ${level} warning level.`,
        "Every airtime, data, TV and electricity purchase is paid from this balance. When it runs out, customers' purchases fail and they are refunded.",
        "Top up the Peyflex wallet. Money collected from customers' Moneta accounts (Admin console → Collections) can be used for this.",
        "You'll get this email at most once every 6 hours while the balance stays low.",
      ],
    );
  })().catch((err) => logger.error({ err: (err as Error).message }, "peyflex_low_balance_alert_failed"));
}
