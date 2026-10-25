import { Router } from "express";

import { monnifyWebhookHandler } from "../controller/webhook.controller.js";

export const webhookRoutes = Router();

webhookRoutes.post("/monnify", monnifyWebhookHandler);
