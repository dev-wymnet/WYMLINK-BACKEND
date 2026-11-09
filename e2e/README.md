# Local end-to-end checks

Everything here runs against a **local** stack: an embedded Postgres, a fake Peyflex and a
fake Moneta. Nothing calls a live service and no money moves. The backend's own `.env`
points at the **live** database and the live Peyflex token, so always start the backend
with `DOTENV_CONFIG_PATH=e2e/test.env` (see `test.env.example`).

## Set up (once)

```bash
cd e2e
npm install                  # embedded-postgres, pg, playwright-core, jsqr, pngjs
cp test.env.example test.env
```

The browser checks drive Microsoft Edge (`channel: "msedge"`), which is installed on this PC.

## Start the stack

Each in its own terminal (or in the background), from `e2e/`:

```bash
node teststack.mjs                    # Postgres :5433, fake Peyflex :4590, fake Moneta :4592, helper :4591
node latency-proxy.mjs 5434 5433 33   # optional: the database behind a ~66 ms round trip, like live
node fwd-proxy.mjs 4596               # only for e2e-lanes.mjs: a stand-in for Fixie
```

The helper on :4591 takes `POST /sql`, `POST /moneta/credit {accountNumber, amount}`,
`POST /moneta/mode {rejectDigitsInName, failCreate, createDelayMs}`, `GET /calls`.
Fake Peyflex declines numbers ending in `0099` and is slow (1.5 s) for numbers ending in `0098`.
Every restart of `teststack.mjs` starts from an empty database.

Then, from the backend's root folder:

```bash
DOTENV_CONFIG_PATH=e2e/test.env node --import tsx src/index.ts          # migrates on start
DOTENV_CONFIG_PATH=e2e/test.env npx tsx src/scripts/createSuperAdmin.ts # admin@test.local
```

For `e2e-lanes.mjs`, uncomment `MONETA_PROXY_URL` in `test.env` and restart the backend.

## The checks

| Script | What it proves | Last result (2026-11-09) |
|---|---|---|
| `e2e-event.mjs` | Account number at sign-up without BVN/NIN, customer ID in the account name, Moneta down at sign-up, free event allowances (per customer, per recipient, TV base plans), declined orders, 5 concurrent buys, budget, collections ignore free orders, kill switch, business QR payments, shared-IP rate limits | 78 / 78 |
| `e2e-concurrency.mjs` | A rush: 30 customers at once, 6 on one phone, budget under a rush, kill switch mid-rush, the running total always equals the orders | 17 / 17 |
| `e2e-lanes.mjs` | Through a real proxy: a QR payment is not held up by queued account openings | 6 / 6 |
| `e2e-digits.mjs` | Moneta refusing digits in the account name: the ID is spelt in letters | pass (run on a fresh backend process: it sets a process-wide flag) |
| `web-event.mjs <out>` | Website on a phone screen: sign-up → PIN → event popup → free data → history → TV → pay page → admin event page and QR | pass |
| `web-qr-newuser.mjs <out>` | Someone without an account scans a business QR, signs up and lands back on the pay page; the QR poster downloads and decodes | pass |
| `app-web.mjs <out>` | The mobile app (web build): sign-up → passcode → PIN → popup → free data → Scan to pay (typed code) → paid | pass |

Run them from `e2e/`, e.g. `node e2e-event.mjs`. The suites create fresh customers each run.

- **Website**: in the website repo run
  `API_BASE_URL=http://localhost:4000/api/v1 NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1 BFF_SHARED_SECRET= npx next dev -p 3005`.
- **Mobile app on web**: in the mobile repo run
  `CI=1 EXPO_PUBLIC_API_URL=http://localhost:4000/api/v1 npx expo start --web --port 8081`
  (the web build keeps the session in memory: navigate inside the app, don't reload).
