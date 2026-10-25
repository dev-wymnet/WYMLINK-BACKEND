# Backend Technical Overview

This document provides a technical overview of the backend service: its architecture, modules, core flows, background processing, data, and operational concerns.

---

## High-level Architecture

- **Framework**: Node.js + Express.
- **Language/Build**: TypeScript compiled to JS (`src` -> `dist`).
- **Database**: PostgreSQL via a DB layer (migrations and pooling handled in `core/db`).
- **Caching/Queues**: Redis used as a BullMQ broker for background job processing (no general caching/session storage).
- **HTTP API**: REST under `/api/v1` for customers and `/api/v1/admin` for administrators.
- **Process Roles**: Controlled by `PROCESS_ROLE` env var: `api` (HTTP server), `worker` (background jobs), or `all` (both). See `src/index.ts`.

---

## Entry Points & Bootstrapping

- `src/index.ts`
  - Loads environment config, initializes DB, seeds country data when needed.
  - Starts workers (webhooks, payouts, telecom retry loop) when `PROCESS_ROLE` includes `worker`.
  - Starts HTTP server when `PROCESS_ROLE` includes `api`.
  - Graceful shutdown: closes job workers, BullMQ queues, Redis, and the PG pool.
- `src/server.ts`
  - Creates the Express app, middleware, health endpoints (`/health`, `/ready`).
  - Mounts feature routes (customer and admin) under `/api/v1` and `/api/v1/admin`.

---

## Configuration

- Centralized in `src/core/config`.
- `env.ts` validates required env vars (e.g., `DATABASE_URL`, `REDIS_URL`, Monnify credentials, retry intervals).
- `index.ts` exposes typed `env` accessors.

---

## Core Concerns

### Authentication & Authorization
- Customer auth (`/auth`): signup, login, refresh, logout.
- Admin auth (`/admin/auth`): login, refresh, logout, and a temporary bootstrap signup.
- Guards/middleware:
  - `authGuard` authenticates JWT/bearer tokens and attaches user/admin context.
  - `requireAdmin` enforces admin-only endpoints.
  - `requirePermission` for fine-grained admin permissions (e.g., `ADMIN_VIEW_PAYMENTS`, `ADMIN_MANAGE_ADMINS`).

### Rate Limiting
- Applied at selected endpoints (e.g., BVN/NIN verification, payout validations) to prevent abuse.
- Implemented at route level using middleware with per-user windows.

### Validation & Error Handling
- Request schemas validated at controllers.
- Service layer throws typed errors mapped to HTTP responses by a global error handler.

### Logging & Observability
- Structured logging via a `logger` utility.
- Health (`/health`) and readiness (`/ready`) probes for orchestration.
- System debug endpoints under `/system` for operational diagnostics (non-auth).

---

## Domain Modules (Customer)

### Dashboard (`/dashboard`)
- `GET /dashboard/home`: aggregates quick user stats and recent activity.

### User (`/user`)
- Profile: `GET/PATCH /user/me`.
- Account update requests: create/list.
- Support tickets: create/list.
- Reloadly enable (admin action).
- Verification: `POST /user/me/verification/bvn`, `POST /user/me/verification/nin` with rate limits.

### Auth & PIN (`/auth`, `/auth/pin`)
- Auth: signup/login/refresh/logout.
- PIN: set/change/reset transaction PIN and passcode; selected routes require customer auth.

### Wallet (`/wallets`)
- Create wallet, get current wallet, list transactions, get transaction by id.
- Reconciliation and debit endpoints for internal flows, guarded by auth and service checks.

### Telecom (`/telecom`) and Bills (`/bills`)
- Networks and data plans discovery.
- Airtime/data purchases.
- Cable/electricity providers/plans, verification, and subscriptions.

### Payouts (`/payouts`)
- Create payout, list banks, validate account, get payout by id, and status by reference.
- Integrates with Monnify for disbursements (async processing via workers).

### Geolocation (`/regions`) & System (`/system`)
- Current region for feature flags/UX.
- System architecture/env/db/readiness diagnostics (public, non-sensitive summaries).

---

## Admin Modules (`/admin`)

- **Dashboard**: high-level KPIs for administrators.
- **Customers**: list/get customers; list transactions; update customer status.
- **Payments**: list/get payments with rich filtering.
- **Bills**: list/get telecom transactions with filters.
- **Admin Management**: CRUD and session management for admin users; update status/role (permission-gated).
- **Payouts OTP**: validate/resend payout OTPs for compliance flows.

Each admin route is protected by `authGuard`, `requireAdmin`, and often `requirePermission`.

---

## Background Processing (Redis + BullMQ)

- Redis connection: `src/core/queue/queue.factory.ts` creates a singleton `ioredis` client from `env.REDIS_URL`.
- Queue registry: `src/core/queue/queue.registry.ts` manages named BullMQ queues with sensible defaults (retries, exponential backoff, cleanup policy).

### Workers
- Payout Worker: `src/modules/payout/worker/payout.worker.ts`
  - Queue: `payouts`, Job: `process-payout` (idempotent via `jobId` per reference).
  - Flow: claim payout -> call Monnify -> update status -> on failure try reconcile -> on terminal failure credit refund atomically.
  - Concurrency: 2.
- Webhook Workers: `src/modules/webhooks/queues/webhook.queues.ts` and `.../workers`
  - Queues: `payments`, `telecom`, `notifications`, `compliance`.
  - Encapsulate incoming provider webhooks for async processing with retries.
  - Concurrency: 5.
- Telecom Retry: interval job (`runTelecomRetryOnce`) to retry pending telecom transactions.

### Lifecycle
- Started in `src/index.ts` when `PROCESS_ROLE` includes `worker`.
- Graceful close on SIGTERM: workers, queues, Redis, then PG.

---

## External Integrations

- **Monnify**: Disbursement APIs for payouts and transaction reconciliation.
- **Telecom Providers**: Airtime/data providers (e.g., Peyflex, Reloadly). Provider selection can be dynamic by region.

---

## Data & Transactions

- PostgreSQL stores users, wallets, ledger entries, payouts, telecom transactions, support tickets, and admin users.
- Atomic updates enforce consistency for critical flows (e.g., `updatePayoutStatusAtomic`, wallet credit/debit functions).
- Money amounts handled with safe parsing and minor units where appropriate.

---

## Security Considerations

- JWT-based auth tokens for customers and admins.
- Role- and permission-based access control for admin routes.
- Rate limits on sensitive endpoints (PIN, verification, account validation, payouts).
- Input validation and centralized error handling.
- Public system endpoints expose only non-sensitive summaries.

---

## Operational Endpoints

- Health: `GET /health` (liveness)
- Readiness: `GET /ready` (dependencies check)
- System diagnostics: `/system/*` (architecture/env/db/readiness summaries)

---

## Testing & Local Development

- `.env.example` documents required env variables (DB, Redis, Monnify, etc.).
- `docker-compose.yml` provisions Redis and Postgres for local dev.
- Start modes via `PROCESS_ROLE` for API/worker isolation.

---

## API Surface

See `docs/admin_api.postman.md` for the full, canonical list of endpoints (customer and admin), including required headers, request/response shapes, and notes such as rate limits.

---

## Future Enhancements

- Optional Redis-backed caching for hot reads (currently no general caching is used).
- Distributed tracing across API and workers.
- Hardened idempotency keys for all external-facing write endpoints.
- Expanded health/readiness checks (DB/Redis deep checks).
