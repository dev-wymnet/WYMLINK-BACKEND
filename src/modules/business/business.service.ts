import { randomBytes, randomInt } from "node:crypto";
import bcrypt from "bcrypt";
import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../../core/db/client.js";
import { businesses, transfers, users } from "../../core/db/schema.js";
import { NotFoundError } from "../../core/errors/NotFoundError.js";
import { ValidationError } from "../../core/errors/ValidationError.js";
import { logger } from "../../core/logger/logger.js";
import { insertAuditLog } from "../audit/repository/audit.repository.js";
import { getMyVirtualAccount, retryAccount } from "../banking/account.service.js";
import { createTransfer, transferDtoFor } from "../banking/transfer.service.js";
import { createUser } from "../user/repository/user.repository.js";
import { getOrCreateWallet } from "../wallet/repository/wallet.repository.js";

// WymNet's own businesses (db/migrations/0010_events_businesses_codes.sql). Each has an
// internal account (role "business": it never signs in) with a wallet and a Moneta account
// number, and a fixed code printed as a QR code. A customer scans it, enters an amount and
// their PIN, and the money moves as an ordinary Wymlink transfer into the business account.

type Business = typeof businesses.$inferSelect;
type Staff = { id: string; role?: string | undefined; ip?: string | undefined; userAgent?: string | undefined };

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1: read aloud without mistakes
const newCode = () => Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
const isUniqueViolation = (err: any) => (err?.code ?? err?.cause?.code) === "23505";

const audit = (staff: Staff, action: string, targetId: string, after: unknown) =>
  insertAuditLog({
    actorUserId: staff.id,
    actorRole: staff.role ?? null,
    action,
    targetType: "business",
    targetId,
    success: true,
    after: after as any,
    ip: staff.ip ?? null,
    userAgent: staff.userAgent ?? null,
  });

async function byCode(code: string) {
  const rows = await db.select().from(businesses).where(eq(businesses.code, code.toUpperCase())).limit(1);
  return rows[0] ?? null;
}

async function detail(b: Business) {
  const va = await getMyVirtualAccount(b.userId);
  const wallet = await getOrCreateWallet(b.userId);
  const stats = await db.execute(sql`
    select count(*)::int as n, coalesce(sum(amount), 0)::numeric(18,2)::text as total, max(completed_at) as last_at
      from app.transfers where recipient_user_id = ${b.userId}::uuid and status = 'success'`);
  const s = stats.rows[0] as { n: number; total: string; last_at: Date | null };
  return {
    id: b.id,
    name: b.name,
    code: b.code,
    active: b.active,
    account: va ? { accountNumber: va.accountNumber, accountName: va.accountName, bankName: va.bankName } : null,
    balance: wallet.availableBalance,
    payments: { count: Number(s.n), total: s.total, lastAt: s.last_at },
    createdAt: b.createdAt,
  };
}

// ---------- Staff ----------

export async function listBusinesses() {
  const rows = await db.select().from(businesses).orderBy(businesses.createdAt);
  return Promise.all(rows.map(detail));
}

// Creates the business, its internal account and wallet, then opens its Moneta account
// number (named after the business). If Moneta fails, the business exists without an
// account number and staff press "Try again".
export async function createBusiness(input: { name: string; staff: Staff }) {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!/[A-Za-z]/.test(name)) throw new ValidationError("Give the business a name with letters");
  // Nobody knows this password: the account can't sign in (login also refuses the role).
  const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
  let created: Business | null = null;
  for (let attempt = 0; attempt < 8 && !created; attempt++) {
    const code = newCode();
    try {
      created = await db.transaction(async (tx) => {
        const user = await createUser(tx, {
          firstName: name.slice(0, 100),
          lastName: "(Business)",
          email: `business.${code.toLowerCase()}@wymnet.org`,
          phone: null,
          passwordHash,
          role: "business",
        });
        await tx.update(users).set({ kycTier: 3, customerCode: `WB${code}` }).where(eq(users.id, user.id));
        await getOrCreateWallet(user.id, tx);
        const [b] = await tx.insert(businesses).values({ userId: user.id, name, code, createdBy: input.staff.id }).returning();
        return b!;
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err; // code taken: try another
    }
  }
  if (!created) throw new Error("Couldn't create a business code");
  await audit(input.staff, "BUSINESS_CREATED", created.id, { name, code: created.code });
  logger.info({ businessId: created.id }, "business_created");
  await retryAccount(created.userId).catch((err) => logger.warn({ businessId: created!.id, err: (err as Error).message }, "business_account_open_failed"));
  return detail(created);
}

export async function openBusinessAccount(id: string, staff: Staff) {
  const [b] = await db.select().from(businesses).where(eq(businesses.id, id)).limit(1);
  if (!b) throw new NotFoundError("Business not found");
  const va = await retryAccount(b.userId);
  if (!va) throw new ValidationError("Moneta couldn't open the account number yet. Try again in a minute.");
  await audit(staff, "BUSINESS_ACCOUNT_OPENED", b.id, { accountNumber: va.accountNumber });
  return detail(b);
}

export async function setBusinessActive(id: string, active: boolean, staff: Staff) {
  const [b] = await db.update(businesses).set({ active }).where(eq(businesses.id, id)).returning();
  if (!b) throw new NotFoundError("Business not found");
  await audit(staff, active ? "BUSINESS_ENABLED" : "BUSINESS_DISABLED", b.id, { active });
  return detail(b);
}

export async function businessPayments(id: string, limit: number) {
  const [b] = await db.select().from(businesses).where(eq(businesses.id, id)).limit(1);
  if (!b) throw new NotFoundError("Business not found");
  const rows = await db
    .select({ t: transfers, first: users.firstName, last: users.lastName, code: users.customerCode })
    .from(transfers)
    .innerJoin(users, eq(users.id, transfers.senderUserId))
    .where(eq(transfers.recipientUserId, b.userId))
    .orderBy(desc(transfers.createdAt))
    .limit(limit);
  return rows.map(({ t, first, last, code }) => ({
    id: t.id,
    payer: `${first} ${last}`.trim(),
    payerCode: code,
    amount: t.amount,
    status: t.status === "success" ? "success" : t.status === "reversed" ? "failed" : "pending",
    createdAt: t.createdAt,
    completedAt: t.completedAt,
  }));
}

// ---------- Customers ----------

// What a scanned code shows before paying (no sign-in needed).
export async function publicBusiness(code: string) {
  const b = await byCode(code);
  if (!b) throw new NotFoundError("This QR code isn't a Wymlink business.");
  const va = await getMyVirtualAccount(b.userId);
  return { code: b.code, name: b.name, acceptsPayments: b.active && Boolean(va) };
}

export async function payBusiness(input: { userId: string; code: string; reference: string; amountCents: bigint }) {
  const b = await byCode(input.code);
  if (!b) throw new NotFoundError("This QR code isn't a Wymlink business.");
  if (!b.active) throw new ValidationError(`${b.name} isn't taking payments right now.`);
  if (b.userId === input.userId) throw new ValidationError("A business can't pay itself.");
  const va = await getMyVirtualAccount(b.userId);
  if (!va) throw new ValidationError(`${b.name} isn't ready for payments yet.`);
  const transfer = await createTransfer({
    senderId: input.userId,
    reference: `biz:${b.code}:${input.reference}`,
    recipient: va.accountNumber,
    amountCents: input.amountCents,
    narration: `Payment to ${b.name}`,
    // One Moneta call instead of two: the customer is waiting at the till.
    quick: true,
  });
  return { business: { code: b.code, name: b.name }, transfer: await transferDtoFor(transfer, input.userId) };
}
