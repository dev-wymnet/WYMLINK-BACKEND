import { Router } from "express";

import { authGuard } from "../../../core/middleware/authGuard.js";
import { currentRegionHandler } from "../controller/geolocation.controller.js";

export const geolocationRoutes = Router();

geolocationRoutes.get("/current", authGuard, currentRegionHandler);
