import type { RequestHandler } from "express";
import { z } from "zod";

import { env } from "../../core/config/env.js";
import { ServiceUnavailableError } from "../../core/errors/AppError.js";
import { UnauthorizedError } from "../../core/errors/UnauthorizedError.js";
import { ValidationError } from "../../core/errors/ValidationError.js";
import { normalizePhone } from "../../core/utils/identity.js";
import { parseMoneyToCents } from "../../core/utils/money.js";
import { verifyTransactionPin } from "../auth/service/pin.service.js";
import { findUserById } from "../user/repository/user.repository.js";
import { peyflex } from "./providers/peyflex.js";
import { reloadlyAirtime } from "./providers/reloadly.js";
import { getMyOrder, listMyOrders, placeOrder, toOrderDto } from "./vtu.service.js";

const reference = z.string().min(8).max(128).regex(/^[A-Za-z0-9_\-:.]+$/, "Invalid reference");
const pin = z.string().regex(/^\d{4}$/);

const AIRTIME_MIN = 50;
const AIRTIME_MAX = 50_000;
const POWER_MIN = 1_000;
const POWER_MAX = 500_000;

const naira = (n: number) => parseMoneyToCents(n.toFixed(2));
const localPhone = (e164: string) => (e164.startsWith("+234") ? `0${e164.slice(4)}` : e164.replace(/^\+/, ""));
const amountOf = (p: any) => Number(p?.amount ?? p?.price ?? NaN);
const nameOf = (r: any): string | null => {
  const n = r?.customer_name ?? r?.customerName ?? r?.name ?? r?.data?.customer_name;
  return typeof n === "string" && n.trim() ? n.trim().slice(0, 200) : null;
};

function requirePeyflex() {
  if (!env.PEYFLEX_API_TOKEN) throw new ServiceUnavailableError("Bill payments are not available yet.");
}

const wrap =
  (fn: (req: Parameters<RequestHandler>[0]) => Promise<unknown>, status = 200): RequestHandler =>
  async (req, res, next) => {
    try {
      res.status(status).json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

const userOf = (req: Parameters<RequestHandler>[0]) => {
  if (!req.user) throw new UnauthorizedError();
  return req.user.id;
};

// ---------- Catalogue ----------

export const networksHandler = wrap(async () => peyflex.networks());

export const dataPlansHandler = wrap(async (req) => {
  const q = z.object({ network: z.string().min(1).max(50) }).parse(req.query);
  return { network: q.network, plans: await peyflex.dataPlans(q.network) };
});

export const cableProvidersHandler = wrap(async () => ({ providers: await peyflex.cableProviders() }));

export const cablePlansHandler = wrap(async (req) => {
  const q = z.object({ identifier: z.string().min(1).max(50) }).parse(req.query);
  return { plans: await peyflex.cablePlans(q.identifier) };
});

export const electricityPlansHandler = wrap(async () => ({ plans: await peyflex.electricityPlans() }));

export const cableVerifyHandler = wrap(async (req) => {
  userOf(req);
  const body = z.object({ identifier: z.string().min(1).max(50), iuc: z.string().regex(/^\d{6,20}$/) }).parse(req.body ?? {});
  return peyflex.verifyCable(body);
});

export const electricityVerifyHandler = wrap(async (req) => {
  userOf(req);
  const q = z
    .object({ meter: z.string().regex(/^\d{6,20}$/), plan: z.string().min(1).max(50), type: z.enum(["prepaid", "postpaid"]) })
    .parse(req.query);
  return peyflex.verifyMeter(q);
});

// ---------- Purchases (PIN-approved; prices always come from the provider) ----------

export const buyAirtimeHandler = wrap(async (req) => {
  const userId = userOf(req);
  const body = z
    .object({ internalReference: reference, network: z.string().min(1).max(50), amount: z.number().int().min(AIRTIME_MIN).max(AIRTIME_MAX), mobileNumber: z.string().min(7).max(20), transactionPin: pin })
    .parse(req.body ?? {});
  await verifyTransactionPin({ userId, pin: body.transactionPin });

  const user = await findUserById(userId);
  const viaReloadly = Boolean(user?.reloadlyEnabled);
  if (!viaReloadly) requirePeyflex();
  const phone = normalizePhone(body.mobileNumber);

  const order = await placeOrder(
    {
      userId,
      reference: body.internalReference,
      product: "airtime",
      provider: viaReloadly ? "reloadly" : "peyflex",
      service: body.network,
      recipient: phone,
      amountCents: naira(body.amount),
      description: `Airtime ₦${body.amount.toLocaleString("en-NG")} to ${localPhone(phone)}`,
    },
    () =>
      viaReloadly
        ? reloadlyAirtime({ reference: body.internalReference, amount: body.amount, mobileNumber: phone })
        : peyflex.buyAirtime({ network: body.network, amount: body.amount, mobileNumber: localPhone(phone) }),
  );
  return { transaction: toOrderDto(order) };
});

export const buyDataHandler = wrap(async (req) => {
  const userId = userOf(req);
  const body = z
    .object({ internalReference: reference, network: z.string().min(1).max(50), planCode: z.string().min(1).max(100), mobileNumber: z.string().min(7).max(20), transactionPin: pin })
    .parse(req.body ?? {});
  await verifyTransactionPin({ userId, pin: body.transactionPin });
  requirePeyflex();

  const plan = (await peyflex.dataPlans(body.network)).find((p: any) => String(p.plan_code ?? p.planCode) === body.planCode);
  const price = amountOf(plan);
  if (!plan || !Number.isFinite(price) || price <= 0) throw new ValidationError("That data plan is no longer available");
  const planName = String(plan.label ?? plan.display ?? plan.name ?? body.planCode).slice(0, 200);
  const phone = normalizePhone(body.mobileNumber);

  const order = await placeOrder(
    {
      userId,
      reference: body.internalReference,
      product: "data",
      provider: "peyflex",
      service: body.network,
      planCode: body.planCode,
      planName,
      recipient: phone,
      amountCents: naira(price),
      description: `${planName} data to ${localPhone(phone)}`,
    },
    () => peyflex.buyData({ network: body.network, planCode: body.planCode, mobileNumber: localPhone(phone) }),
  );
  return { transaction: toOrderDto(order) };
});

export const buyCableHandler = wrap(async (req) => {
  const userId = userOf(req);
  const body = z
    .object({
      internalReference: reference,
      identifier: z.string().min(1).max(50),
      plan: z.string().min(1).max(100),
      iuc: z.string().regex(/^\d{6,20}$/),
      phone: z.string().min(7).max(20),
      // Ignored: the price is the plan's price. Kept for older clients.
      amount: z.number().optional(),
      transactionPin: pin,
    })
    .parse(req.body ?? {});
  await verifyTransactionPin({ userId, pin: body.transactionPin });
  requirePeyflex();

  const plan = (await peyflex.cablePlans(body.identifier)).find((p: any) => String(p.plan_code ?? p.planCode) === body.plan);
  const price = amountOf(plan);
  if (!plan || !Number.isFinite(price) || price <= 0) throw new ValidationError("That plan is no longer available");
  const planName = String(plan.display ?? plan.name ?? plan.description ?? body.plan).slice(0, 200);
  const customer = nameOf(await peyflex.verifyCable({ identifier: body.identifier, iuc: body.iuc }));
  const phone = normalizePhone(body.phone);

  const order = await placeOrder(
    {
      userId,
      reference: body.internalReference,
      product: "cable",
      provider: "peyflex",
      service: body.identifier,
      planCode: body.plan,
      planName,
      recipient: body.iuc,
      recipientName: customer,
      amountCents: naira(price),
      description: `${planName} for ${body.iuc}`,
    },
    () => peyflex.buyCable({ identifier: body.identifier, plan: body.plan, iuc: body.iuc, phone: localPhone(phone), amount: price }),
  );
  return { transaction: toOrderDto(order) };
});

export const buyElectricityHandler = wrap(async (req) => {
  const userId = userOf(req);
  const body = z
    .object({
      internalReference: reference,
      meter: z.string().regex(/^\d{6,20}$/),
      plan: z.string().min(1).max(50),
      amount: z.number().min(POWER_MIN).max(POWER_MAX),
      type: z.enum(["prepaid", "postpaid"]),
      phone: z.string().min(7).max(20),
      providerName: z.string().max(100).optional(),
      transactionPin: pin,
    })
    .parse(req.body ?? {});
  if (Math.round(body.amount * 100) !== body.amount * 100) throw new ValidationError("Invalid amount");
  await verifyTransactionPin({ userId, pin: body.transactionPin });
  requirePeyflex();

  const plan = (await peyflex.electricityPlans()).find((p: any) => String(p.plan_code ?? p.plan_id ?? p.planCode) === body.plan);
  if (!plan) throw new ValidationError("Choose your electricity company from the list");
  const min = Number(plan.min_amount ?? POWER_MIN);
  const max = Number(plan.max_amount ?? POWER_MAX);
  if (Number.isFinite(min) && body.amount < min) throw new ValidationError(`The minimum for this company is ₦${min.toLocaleString("en-NG")}`);
  if (Number.isFinite(max) && body.amount > max) throw new ValidationError(`The maximum for this company is ₦${max.toLocaleString("en-NG")}`);
  const disco = String(plan.plan_name ?? body.providerName ?? body.plan).slice(0, 200);
  const customer = nameOf(await peyflex.verifyMeter({ meter: body.meter, plan: body.plan, type: body.type }));
  const phone = normalizePhone(body.phone);

  const order = await placeOrder(
    {
      userId,
      reference: body.internalReference,
      product: "electricity",
      provider: "peyflex",
      service: body.plan,
      planName: disco,
      recipient: body.meter,
      recipientName: customer,
      meterType: body.type,
      amountCents: naira(body.amount),
      description: `${disco} ${body.type} ₦${body.amount.toLocaleString("en-NG")} for meter ${body.meter}`,
    },
    () => peyflex.buyElectricity({ meter: body.meter, plan: body.plan, amount: body.amount, type: body.type, phone: localPhone(phone) }),
  );
  return { transaction: toOrderDto(order) };
});

// ---------- Order history ----------

export const myOrdersHandler = wrap(async (req) => {
  const userId = userOf(req);
  const q = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
  return { orders: (await listMyOrders(userId, q.limit)).map(toOrderDto) };
});

export const myOrderHandler = wrap(async (req) => {
  const userId = userOf(req);
  const id = z.string().uuid().parse(req.params.id);
  return { order: toOrderDto(await getMyOrder(userId, id)) };
});
