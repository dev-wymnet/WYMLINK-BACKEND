import { Router } from "express";
import { limiter } from "../../core/middleware/rateLimits.js";

import { authGuard } from "../../core/middleware/authGuard.js";
import {
  buyAirtimeHandler,
  buyCableHandler,
  buyDataHandler,
  buyElectricityHandler,
  cablePlansHandler,
  cableProvidersHandler,
  cableVerifyHandler,
  dataPlansHandler,
  electricityPlansHandler,
  electricityVerifyHandler,
  myOrderHandler,
  myOrdersHandler,
  networksHandler,
} from "./vtu.controller.js";

// Per customer: purchases and name look-ups both cost money at the provider.
const perUser = (max: number) => limiter({ windowMs: 60 * 1000, max, by: "user" });
const purchaseLimiter = perUser(10);
const verifyLimiter = perUser(20);

export const telecomRoutes = Router();
telecomRoutes.get("/networks", authGuard, networksHandler);
telecomRoutes.get("/data/plans", authGuard, dataPlansHandler);
telecomRoutes.post("/airtime/purchase", authGuard, purchaseLimiter, buyAirtimeHandler);
telecomRoutes.post("/data/purchase", authGuard, purchaseLimiter, buyDataHandler);

export const billsRoutes = Router();
billsRoutes.get("/cable/providers", cableProvidersHandler);
billsRoutes.get("/cable/plans", cablePlansHandler);
billsRoutes.post("/cable/verify", authGuard, verifyLimiter, cableVerifyHandler);
billsRoutes.post("/cable/subscribe", authGuard, purchaseLimiter, buyCableHandler);
billsRoutes.get("/electricity/plans", electricityPlansHandler);
billsRoutes.get("/electricity/verify", authGuard, verifyLimiter, electricityVerifyHandler);
billsRoutes.post("/electricity/subscribe", authGuard, purchaseLimiter, buyElectricityHandler);

export const ordersRoutes = Router();
ordersRoutes.get("/", authGuard, myOrdersHandler);
ordersRoutes.get("/:id", authGuard, myOrderHandler);
