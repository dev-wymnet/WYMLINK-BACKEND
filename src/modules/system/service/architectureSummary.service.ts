import { env } from "../../../core/config/env.js";

export interface ArchitectureSummary {
  backend: {
    framework: string;
    language: string;
    runtime: string;
  };
  database: {
    engine: string;
    orm: string;
    migrations: string;
  };
  cache: {
    engine: string;
    version: string;
    purpose: string[];
  };
  wallet: {
    architecture: string;
    precision: string;
    idempotency: boolean;
    multiCurrency: boolean;
  };
  security: {
    accessTokenTtl: number;
    refreshTokenTtl: number;
    sessionManagement: string;
  };
  compliance: {
    modules: string[];
    regions: string[];
    features: string[];
  };
  integrations: {
    paymentProviders: string[];
    telecomProviders: string[];
    kycProviders: string[];
    geolocationProviders: string[];
  };
  infrastructure: {
    queue: string;
    logging: string;
    monitoring: string;
  };
}

export function generateArchitectureSummary(): ArchitectureSummary {
  return {
    backend: {
      framework: "Express",
      language: "TypeScript",
      runtime: "Node.js",
    },
    database: {
      engine: "PostgreSQL",
      orm: "Drizzle ORM",
      migrations: "Drizzle Kit (SQL)",
    },
    cache: {
      engine: "Redis",
      version: "6.x",
      purpose: ["caching", "queue (BullMQ)", "session storage"],
    },
    wallet: {
      architecture: "Ledger-driven with atomic transactions",
      precision: "numeric(20,8) - BigInt arithmetic in application layer",
      idempotency: true,
      multiCurrency: true,
    },
    security: {
      accessTokenTtl: env.JWT_ACCESS_TTL_SECONDS,
      refreshTokenTtl: env.REFRESH_TOKEN_TTL_SECONDS,
      sessionManagement: "Database-backed sessions with refresh tokens",
    },
    compliance: {
      modules: ["compliance", "geolocation", "webhooks"],
      regions: ["FINTRAC (CA)", "FINCEN (US)", "CBN (NG)", "VARA (AE)"],
      features: [
        "FINTRAC large transaction flagging (>10,000 CAD)",
        "Nigeria tiered transaction limits (database-driven)",
        "Geofencing with regional routing",
        "Queue-based webhook processing with retry logic",
      ],
    },
    integrations: {
      paymentProviders: ["Monnify (Nigeria)"],
      telecomProviders: ["Peyflex (Nigeria)"],
      kycProviders: ["Nigeria (NIMC BVN/NIN)", "USA (SSN/TIN OFAC)", "Canada (SIN Equifax/TransUnion)"],
      geolocationProviders: ["Static country-based mapping (MaxMind-ready)"],
    },
    infrastructure: {
      queue: "BullMQ + Redis (supports future AWS SQS/Kafka migration)",
      logging: "Pino structured logging",
      monitoring: "Not implemented (ready for APM integration)",
    },
  };
}
