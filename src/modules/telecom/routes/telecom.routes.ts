import { Router } from "express";

import { authGuard } from "../../../core/middleware/authGuard.js";
import {
  telecomDataPlansHandler,
  telecomNetworksHandler,
  telecomPurchaseAirtimeHandler,
  telecomPurchaseDataHandler,
} from "../controllers/telecom.controller.js";

export const telecomRoutes = Router();

telecomRoutes.get("/networks", authGuard, telecomNetworksHandler);
telecomRoutes.get("/data/plans", authGuard, telecomDataPlansHandler);

telecomRoutes.post(
  "/airtime/purchase",
  authGuard,
  telecomPurchaseAirtimeHandler,
);
telecomRoutes.post("/data/purchase", authGuard, telecomPurchaseDataHandler);
