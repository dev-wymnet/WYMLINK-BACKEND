import { Router } from "express";
import { authGuard } from "../../../core/middleware/authGuard.js";
import {
  cableProvidersHandler,
  cablePlansHandler,
  cableVerifyHandler,
  cableSubscribeHandler,
  electricityPlansHandler,
  electricityVerifyHandler,
  electricitySubscribeHandler,
} from "../controller/bills.controller.js";

export const billsRoutes = Router();

// Cable TV
billsRoutes.get("/cable/providers", cableProvidersHandler);
billsRoutes.get("/cable/plans", cablePlansHandler);
billsRoutes.post("/cable/verify", authGuard, cableVerifyHandler);
billsRoutes.post("/cable/subscribe", authGuard, cableSubscribeHandler);

// Electricity
billsRoutes.get("/electricity/plans", electricityPlansHandler);
billsRoutes.get("/electricity/verify", electricityVerifyHandler);
billsRoutes.post("/electricity/subscribe", authGuard, electricitySubscribeHandler);
