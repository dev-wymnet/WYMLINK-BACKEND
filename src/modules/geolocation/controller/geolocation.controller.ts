import type { RequestHandler } from "express";

import { UnauthorizedError } from "../../../core/errors/UnauthorizedError.js";
import { ValidationError } from "../../../core/errors/ValidationError.js";
import { findUserById } from "../../user/repository/user.repository.js";
import { resolveRegionForRequest } from "../service/geolocation.service.js";

export const currentRegionHandler: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();

    const user = await findUserById(req.user.id);
    if (!user) throw new ValidationError("User not found");

    const ip = typeof req.ip === "string" ? req.ip : null;

    const resolved = await resolveRegionForRequest({
      ip,
      fallbackCountryCode: user.countryCode,
    });

    res.status(200).json({
      countryCode: resolved?.countryCode ?? user.countryCode,
      currency:
        resolved?.preferredCurrency ?? user.preferredCurrency ?? user.currencyCode,
      complianceRegion:
        resolved?.complianceRegion ?? user.complianceRegion ?? "UNKNOWN",
    });
  } catch (err) {
    next(err);
  }
};
