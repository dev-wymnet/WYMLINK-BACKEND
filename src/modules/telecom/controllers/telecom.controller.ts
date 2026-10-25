import type { RequestHandler } from "express";
import { z } from "zod";

import { UnauthorizedError } from "../../../core/errors/UnauthorizedError.js";
import { verifyTransactionPin } from "../../auth/service/pin.service.js";
import { findUserById } from "../../user/repository/user.repository.js";

import {
  purchaseAirtime,
  purchaseData,
  telecomGetDataPlans,
  telecomGetNetworks,
} from "../services/telecom.service.js";

const purchaseAirtimeSchema = z.object({
  internalReference: z.string().min(8).max(128),
  provider: z.enum(["peyflex", "reloadly"]).optional(),
  network: z.string().min(1),
  amount: z.number().positive(),
  mobileNumber: z.string().min(6),
  transactionPin: z.string().regex(/^\d{4}$/),
});

const purchaseDataSchema = z.object({
  internalReference: z.string().min(8).max(128),
  provider: z.enum(["peyflex", "reloadly"]).optional(),
  network: z.string().min(1),
  planCode: z.string().min(1),
  mobileNumber: z.string().min(6),
  transactionPin: z.string().regex(/^\d{4}$/),
});

const dataPlansQuerySchema = z.object({
  provider: z.enum(["peyflex", "reloadly"]).optional(),
  network: z.string().min(1),
});

export const telecomNetworksHandler: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    let provider: "peyflex" | "reloadly" = "peyflex";
    let userCountry: string | null = null;
    try {
      if (req.user) {
        const u = await findUserById(req.user.id);
        userCountry = u?.countryCode ?? null;
        if (u?.countryCode === "CA") provider = "reloadly";
        else if (u?.countryCode === "NG" && (u as any).telecomReloadlyEnabled)
          provider = "reloadly";
      }
    } catch {
      // default to peyflex if any error
    }
    const result = await telecomGetNetworks(provider);
    // If using Reloadly, limit operators to the user's country
    if (provider === "reloadly" && userCountry) {
      const cc = userCountry.toUpperCase();
      const matchCountry = (s: any) => {
        const vUp = String(s ?? "").toUpperCase();
        if (cc === "CA") return vUp === "CA" || vUp.includes("CANADA");
        if (cc === "NG") return vUp === "NG" || vUp.includes("NIGERIA");
        return true;
      };
      const filterList = (arr: any[]) =>
        Array.isArray(arr)
          ? arr.filter((n) => matchCountry((n as any).country))
          : arr;
      (result as any).airtimeNetworks = filterList(
        (result as any).airtimeNetworks,
      );
      (result as any).dataNetworks = filterList((result as any).dataNetworks);
    }
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const telecomDataPlansHandler: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    const q = dataPlansQuerySchema.parse(req.query);

    let provider: "peyflex" | "reloadly" = q.provider ?? "peyflex";
    let userCountry: string | null = null;
    try {
      if (!q.provider && req.user) {
        const u = await findUserById(req.user.id);
        userCountry = u?.countryCode ?? null;
        if (u?.countryCode === "CA") provider = "reloadly";
        else if (u?.countryCode === "NG" && (u as any).telecomReloadlyEnabled)
          provider = "reloadly";
      }
    } catch {
      // ignore, use default
    }

    let network = q.network;
    try {
      const networks = await telecomGetNetworks(provider);
      let list = (networks as any)?.dataNetworks ?? [];
      if (provider === "reloadly" && userCountry) {
        const cc = userCountry.toUpperCase();
        const matchCountry = (s: any) => {
          const vUp = String(s ?? "").toUpperCase();
          if (cc === "CA") return vUp === "CA" || vUp.includes("CANADA");
          if (cc === "NG") return vUp === "NG" || vUp.includes("NIGERIA");
          return true;
        };
        list = Array.isArray(list)
          ? list.filter((n: any) => matchCountry(n?.country))
          : list;
      }
      const norm = (s: unknown) =>
        String(s ?? "")
          .trim()
          .toLowerCase();
      const target = norm(network);
      const match = list.find((n: any) => {
        const candidates = [
          n.code,
          n.slug,
          n.value,
          n.network_code,
          n.identifier,
          n.id,
          n.network,
          n.name,
          n.title,
          n.label,
        ];
        return candidates.some((c: any) => norm(c) === target);
      });
      if (match) {
        network = String(
          match.code ??
            match.slug ??
            match.value ??
            match.network_code ??
            match.identifier ??
            match.id ??
            match.network ??
            match.name ??
            network,
        );
      }
    } catch {
      // ignore mapping errors and use the provided network as-is
    }

    const result = await telecomGetDataPlans({ network, provider });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const telecomPurchaseAirtimeHandler: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const body = purchaseAirtimeSchema.parse(req.body);
    await verifyTransactionPin({
      userId: req.user.id,
      pin: body.transactionPin,
    });

    const result = await purchaseAirtime({
      userId: req.user.id,
      internalReference: body.internalReference,
      ...(body.provider ? { provider: body.provider } : {}),
      network: body.network,
      amount: body.amount,
      mobileNumber: body.mobileNumber,
    });

    res.status(200).json({ transaction: result });
  } catch (err) {
    next(err);
  }
};

export const telecomPurchaseDataHandler: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const body = purchaseDataSchema.parse(req.body);
    await verifyTransactionPin({
      userId: req.user.id,
      pin: body.transactionPin,
    });

    const result = await purchaseData({
      userId: req.user.id,
      internalReference: body.internalReference,
      ...(body.provider ? { provider: body.provider } : {}),
      network: body.network,
      planCode: body.planCode,
      mobileNumber: body.mobileNumber,
    });

    res.status(200).json({ transaction: result });
  } catch (err) {
    next(err);
  }
};
