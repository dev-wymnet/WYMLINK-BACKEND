import express, { type Express, Router } from "express";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import compression from "compression";
import { limiter } from "./core/middleware/rateLimits.js";
import { randomUUID } from "crypto";

import { config } from "./core/config/index.js";
import { logger } from "./core/logger/logger.js";
import { notFoundHandler } from "./core/middleware/notFoundHandler.js";
import { errorHandler } from "./core/middleware/errorHandler.js";
import { clientIp } from "./core/middleware/clientIp.js";
import { getReadiness } from "./core/health/readiness.js";
import swaggerUi from "swagger-ui-express";
import { getOpenAPIDocument } from "./core/docs/openapi.js";

import { authRoutes } from "./modules/auth/routes/auth.routes.js";
import { pinRoutes } from "./modules/auth/routes/pin.routes.js";
import { adminSupportRoutes, userRoutes } from "./modules/user/routes/user.routes.js";
import { logoRoutes } from "./modules/logos/logos.routes.js";
import { walletRoutes } from "./modules/wallet/routes/wallet.routes.js";
import { billsRoutes, ordersRoutes, telecomRoutes } from "./modules/vtu/vtu.routes.js";
import { dashboardRoutes } from "./modules/dashboard/routes/dashboard.routes.js";
import { systemRoutes } from "./modules/system/routes/system.routes.js";
import { trainingRoutes } from "./modules/training/routes/training.routes.js";
import { updatesRoutes } from "./modules/updates/updates.routes.js";
import { qrRoutes } from "./modules/qr/qr.routes.js";
import { accountRoutes, adminBankingRoutes, payoutRoutes, transferRoutes } from "./modules/banking/banking.routes.js";
import { monetaWebhookRoutes } from "./modules/moneta/moneta.webhook.js";
import { adminAuthRoutes } from "./modules/admin/auth/routes/adminAuth.routes.js";
import { adminManagementRoutes } from "./modules/admin/management/routes/admin.routes.js";
import { adminPaymentsRoutes } from "./modules/admin/payments/routes/payments.routes.js";
import { adminBillsRoutes } from "./modules/admin/bills/routes/bills.routes.js";
import { adminDashboardRoutes } from "./modules/admin/dashboard/routes/dashboard.routes.js";
import { adminCustomersRoutes } from "./modules/admin/customers/routes/customers.routes.js";

export function createServer(): Express {
  const app = express();

  // Real client IPs (see core/middleware/clientIp.ts); must run before rate limiting.
  app.set("trust proxy", config.TRUST_PROXY_HOPS);
  app.use(clientIp);

  app.use(helmet());
  app.use(compression());
  app.use(
    cors({
      origin: (config.CORS_ORIGINS === true
        ? true
        : config.CORS_ORIGINS) as any,
      credentials: true,
    }),
  );

  const rateLimiter = limiter({ windowMs: config.RATE_LIMIT_WINDOW_MS, max: config.RATE_LIMIT_MAX });
  app.use(rateLimiter);

  app.use(
    express.json({
      limit: config.REQUEST_JSON_LIMIT,
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  // Request logs carry no headers (bearer tokens, the BFF secret, cookies) and no query
  // strings; the IP is the one rate limits use (req.ip), not a client-supplied header.
  const pathOnly = (url: string | undefined) => String(url ?? "").split("?")[0];
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) =>
        (req.headers["x-request-id"] as string | undefined) || randomUUID(),
      serializers: {
        req: (req: any) => ({ id: req.id, method: req.method, url: pathOnly(req.url) }),
        res: (res: any) => ({ statusCode: res.statusCode }),
      },
      customProps: (req, res) => ({
        service: config.SERVICE_NAME,
        env: config.NODE_ENV,
        requestId: (req as any).id,
        userId: (req as any).user?.id,
        path: pathOnly(req.url),
        method: req.method,
        statusCode: res.statusCode,
        responseTime: (res as any).responseTime,
        ip: (req as any).ip,
        userAgent: req.headers["user-agent"],
      }),
    }),
  );

  const api = express.Router();
  api.get("/health", (_req, res) => {
    res
      .status(200)
      .json({ ok: true, uptimeSeconds: Math.floor(process.uptime()) });
  });

  api.get("/ready", async (_req, res) => {
    const readiness = await getReadiness();
    const status =
      readiness.status === "ok"
        ? 200
        : readiness.status === "degraded"
          ? 200
          : 503;
    res.status(status).json(readiness);
  });

  // OpenAPI documentation: a map of every endpoint, so off in production unless
  // API_DOCS_ENABLED=true.
  if (config.API_DOCS_ENABLED) {
    const openapi = getOpenAPIDocument();
    api.get("/openapi.json", (_req, res) => {
      res.status(200).json(openapi);
    });
    api.use(
      "/api-docs",
      helmet({
        // Swagger UI renders via an inline <script> block, which the strict
        // default CSP (script-src 'self') blocks. Relax it for docs only.
        contentSecurityPolicy: {
          directives: {
            "script-src": ["'self'", "'unsafe-inline'"],
            "upgrade-insecure-requests": null,
          },
        },
      }),
      swaggerUi.serve,
      swaggerUi.setup(openapi),
    );
  }

  api.use("/auth", authRoutes);
  api.use("/auth/pin", pinRoutes);
  api.use("/user", userRoutes);
  api.use("/wallets", walletRoutes);
  api.use("/wallets", accountRoutes);
  api.use("/transfers", transferRoutes);
  api.use("/telecom", telecomRoutes);
  api.use("/bills", billsRoutes);
  api.use("/orders", ordersRoutes);
  api.use("/dashboard", dashboardRoutes);
  api.use("/system", systemRoutes);
  api.use("/training", trainingRoutes);
  api.use("/updates", updatesRoutes);
  api.use("/qr", qrRoutes);
  api.use("/payouts", payoutRoutes);
  api.use("/webhooks", monetaWebhookRoutes);
  api.use("/logos", logoRoutes);

  const admin = Router();
  admin.use("/auth", adminAuthRoutes);
  admin.use("/admins", adminManagementRoutes);
  admin.use("/payments", adminPaymentsRoutes);
  admin.use("/bills", adminBillsRoutes);
  admin.use("/dashboard", adminDashboardRoutes);
  admin.use("/customers", adminCustomersRoutes);
  admin.use("/banking", adminBankingRoutes);
  admin.use("/support", adminSupportRoutes);
  api.use("/admin", admin);

  app.use("/api/v1", api);

  // Convenience redirect so /api-docs works without the version prefix
  if (config.API_DOCS_ENABLED) {
    app.get(["/api-docs", "/docs"], (_req, res) => {
      res.redirect("/api/v1/api-docs");
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
