import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "../../../core/db/client.js";
import { auditLog, beneficiaries, kycProfiles, payouts, transfers, users, vtuOrders, wallets } from "../../../core/db/schema.js";
import { NotFoundError } from "../../../core/errors/NotFoundError.js";
import { ValidationError } from "../../../core/errors/ValidationError.js";
import { logger } from "../../../core/logger/logger.js";
import { parseMoneyToCents } from "../../../core/utils/money.js";
import { CUSTOMER_SESSION_KINDS, revokeUserSessions } from "../../auth/repository/session.repository.js";

// Customer account deletion (Google Play / App Store requirement: in the app and on the web).
//
// Deleting removes the customer's personal details and sign-in: name, email, phone,
// password, PIN and passcode are wiped, saved bank recipients are removed, the wallet is
// closed and every session is signed out. The account can never be signed into again.
//
// Kept, because Nigerian financial regulation requires it: transaction records (ledger,
// deposits, purchases, transfers) and identity-verification records (BVN/NIN checks). These
// are linked to the customer ID only, not to a name, email or phone.
//
// Refused while money is involved: a balance above zero (it must be sent to a bank first)
// or any payment, purchase or transfer still in progress.

export async function deleteMyAccount(input: { userId: string; password: string; ip?: string | undefined; userAgent?: string | undefined }) {
  const [user] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
  if (!user || user.status === "closed") throw new NotFoundError("Account not found");
  if (user.role !== "customer") throw new ValidationError("Staff and business accounts can't be deleted here.");
  if (!(await bcrypt.compare(input.password, user.passwordHash))) throw new ValidationError("That password is not correct.");

  await db.transaction(async (tx) => {
    const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId, user.id)).for("update").limit(1);
    if (wallet && parseMoneyToCents(wallet.availableBalance) > 0n) {
      const amount = Number(wallet.availableBalance).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      throw new ValidationError(`You still have ₦${amount} in your account. Send it to your bank account first, then delete your account.`);
    }
    const busy = async (q: Promise<unknown[]>) => (await q).length > 0;
    if (
      (await busy(tx.select({ id: vtuOrders.id }).from(vtuOrders).where(and(eq(vtuOrders.userId, user.id), inArray(vtuOrders.status, ["pending", "processing", "unknown"]))).limit(1))) ||
      (await busy(tx.select({ id: payouts.id }).from(payouts).where(and(eq(payouts.userId, user.id), inArray(payouts.status, ["pending", "processing", "unknown"]))).limit(1))) ||
      (await busy(tx.select({ id: transfers.id }).from(transfers).where(and(eq(transfers.senderUserId, user.id), inArray(transfers.status, ["processing", "unknown"]))).limit(1)))
    ) {
      throw new ValidationError("A payment or purchase on your account is still being processed. Try again once it has finished.");
    }

    const lockedHash = await bcrypt.hash(randomBytes(32).toString("hex"), 4);
    await tx
      .update(users)
      .set({
        firstName: "Deleted",
        lastName: "Customer",
        email: `deleted-${user.id}@deleted.wymlink.invalid`,
        phone: null,
        emailVerifiedAt: null,
        phoneVerifiedAt: null,
        passwordHash: lockedHash,
        transactionPinHash: null,
        passcodeHash: null,
        status: "closed",
        closedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
    if (wallet) await tx.update(wallets).set({ status: "closed", updatedAt: new Date() }).where(eq(wallets.id, wallet.id));
    await tx.delete(beneficiaries).where(eq(beneficiaries.userId, user.id));
    // The encrypted BVN is only ever needed to open the account number; never keep it.
    await tx.update(kycProfiles).set({ bvnSealed: null, updatedAt: new Date() }).where(eq(kycProfiles.userId, user.id));
    await tx.execute(sql`delete from app.update_subscribers where email = ${user.email ?? ""}`);
    await tx.insert(auditLog).values({
      actorUserId: user.id,
      actorRole: "customer",
      action: "ACCOUNT_DELETED",
      targetType: "user",
      targetId: user.id,
      success: true,
      after: { customerCode: user.customerCode } as any,
      ip: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 400) ?? null,
    });
  });

  await revokeUserSessions({ userId: user.id, kinds: CUSTOMER_SESSION_KINDS, reason: "account_deleted" });
  logger.info({ userId: user.id }, "account_deleted");
  return { deleted: true };
}
