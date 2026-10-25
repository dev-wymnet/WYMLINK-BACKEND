import pino from "pino";
import { env } from "../config/env.js";
import { config } from "../config/index.js";

export const logger = pino({
  level: config.LOG_LEVEL ?? (env.NODE_ENV === "production" ? "info" : "debug"),
  base: {
    service: config.SERVICE_NAME,
    env: env.NODE_ENV,
  },
});
