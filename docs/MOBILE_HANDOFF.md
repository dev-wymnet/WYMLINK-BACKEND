# Wymlink mobile app — handoff

For the next AI agent (or developer) building the Wymlink mobile app.
Read all of it before writing code. Last updated: 2026-10-26.

---

## 1. What Wymlink is

Wymlink is a Nigerian wallet app by **WymNet** (wymnet.org, info@wymnet.org, +234 707 594 9707).
A customer:

1. signs up, sets a 4-digit transaction PIN (and a 6-digit app passcode on mobile),
2. gets a naira wallet (one per customer, NGN only),
3. funds it by bank transfer into a personal virtual account (**not built yet**, see §9),
4. spends it on airtime, data, cable TV and electricity (built and tested),
5. sends money to any Nigerian bank (**not built yet**, see §9),
6. verifies BVN and/or NIN to raise spending limits (built; automated BVN check needs Moneta keys).

The **mobile app is the priority**. A website already exists (Next.js, same backend). The
mobile app must use the **same backend API** described here, with no separate backend.

---

## 2. Status at a glance

| Area | Status |
|---|---|
| Sign-up, login, sessions per device, logout, refresh | ✅ built, tested |
| Transaction PIN (set / change / reset by email code), lockout | ✅ built, tested |
| Mobile passcode (set / verify / change), lockout | ✅ built, tested |
| Wallet balance, transaction history (ledger), order history | ✅ built, tested |
| Airtime, data, cable TV, electricity (Peyflex; Reloadly airtime opt-in) | ✅ built, tested against a fake provider |
| Spending limits by KYC tier | ✅ built, tested |
| KYC: BVN + NIN submission, staff review, tiers | ✅ built, tested (BVN auto-check needs Moneta keys) |
| Support tickets, account-update requests | ✅ built |
| Admin console (KYC review, customers, bills, ledger, staff) | ✅ built (web only) |
| **Virtual account (funding by bank transfer)** | ❌ not built — waiting for WymNet's Moneta credentials |
| **Deposits detection / wallet credit** | ❌ not built (same) |
| **Bank payouts, name enquiry, bank list for payouts** | ❌ not built — endpoints answer 503 "coming soon" |
| **Wymlink-to-Wymlink transfers** | ❌ not built |
| BVN by OTP (NIBSS sends code to BVN phone) | ❌ not built (account-match method is built) |
| Email/phone verification codes at sign-up | ❌ not built (DB supports it: `otp_codes.purpose = verify_email/verify_phone`) |
| Push notifications | ❌ not built |
| Mobile app | ❌ not started — **your job** |

---

## 3. Where things are

| Thing | Location |
|---|---|
| Backend repo (deploys) | https://github.com/dev-wymnet/WYMLINK-BACKEND (branch `main`) |
| Backend local working copy | `C:\Users\IMPULSE\Desktop\WYMNET BACKEND` (git branch `feature/pin-security`, remote = old company repo; **the GitHub repo above is pushed from a clean copy**, not from this folder's git) |
| Website local copy | `C:\Users\IMPULSE\Desktop\WYMNET FRONTEND` (Next.js 16, branch `revamp/web-dashboard`, not yet deployed) |
| Live backend | **https://wymlink-backend.onrender.com/api/v1** (Render free plan, Frankfurt; sleeps after ~15 min idle → first request can take ~50 s) |
| Database | Supabase project `unjupnjycsmmrebpsgrv` (region eu-west-1). All app data is in the private schema `app`. Connect through the **Session pooler** (`aws-0-eu-west-1.pooler.supabase.com:5432`); the direct host is IPv6-only. |
| Schema (source of truth) | `db/migrations/0001_wymlink_core.sql` |
| Backend env reference | `.env.example` (names + meaning; real values live only in Render / local `.env`) |
| Reference integration for Moneta | `C:\Users\IMPULSE\Desktop\Etico backend` (another app by the same owner using Moneta: `api/moneta-va.ts`, `api/nibss-bvn.ts`, `README.md`) — **read it, never copy its secrets** |

Health checks: `GET /api/v1/health` → `{"ok":true}`, `GET /api/v1/ready` → `{"status":"ok","checks":{"postgres":true}}`.

---

## 4. Ground rules (from the owner)

- **Never put secrets in code, docs, commits or chat logs.** Keys go only in Render / Vercel / EAS
  secrets / local `.env` (git-ignored). This repo is pushed to GitHub.
- **Never reuse Etico's credentials** for Wymlink. WymNet has its own Moneta account.
- **No real-money calls while testing.** Peyflex is live: a purchase spends real money. Test
  purchases against a fake provider (see §12).
- Commit/push only when the owner asks. Pushing `main` of WYMLINK-BACKEND **auto-deploys** to Render.
- The owner wants everything from the previous developer replaced, not patched. Don't
  reintroduce Monnify, Redis/BullMQ, the old drizzle migrations, or multi-country code.
- Nigeria only, NGN only. Phone numbers are Nigerian.
- The owner prefers action over questions. Do the work, flag concerns briefly.

---

## 5. Recommended mobile stack

- **Expo (React Native) + TypeScript**, Expo Router. One codebase for Android and iOS.
- `expo-secure-store` for tokens (never AsyncStorage for secrets).
- `expo-local-authentication` for Face ID / fingerprint unlock (as an alternative to the passcode).
- `expo-crypto` → `Crypto.randomUUID()` for purchase references.
- TanStack Query for server state; zod for response validation is a good idea.
- EAS Build for store builds; API base URL via `app.config` / EAS env (`EXPO_PUBLIC_API_URL`), default
  `https://wymlink-backend.onrender.com/api/v1`.

The app talks **directly** to the backend with `Authorization: Bearer <accessToken>`.
(The website uses a server-side proxy with cookies; the mobile app does not need that.)

---

## 6. Brand

Match the website.

| Token | Hex |
|---|---|
| brand-50 / 100 / 200 | `#eef3ff` / `#dbe5ff` / `#bccdff` |
| **brand-500 (primary)** | `#3461f5` |
| brand-600 / 700 / 900 | `#1f45e6` / `#1835c2` / `#0e1e6b` |
| ink (text) / ink-soft / ink-faint | `#0b1220` / `#475467` / `#98a2b3` |
| line (borders) / canvas (background) | `#e7eaf0` / `#f6f7fb` |
| ok / ok-soft | `#12b76a` / `#ecfdf3` |
| warn / warn-soft | `#f79009` / `#fffaeb` |
| bad / bad-soft | `#f04438` / `#fef3f2` |

Fonts: Geist (body); Aeonik Pro for display headings on the website. Naira amounts are shown
as `₦1,234.56` (`en-NG` locale).

---

## 7. Screens and flows to build

### 7.1 Onboarding
1. **Welcome** → Sign up / Log in.
2. **Sign up**: first name, last name, email and/or phone (at least one; collect both), password (8–72 chars).
   Send `client: "mobile"` and a stable `deviceId` (generate once, keep in SecureStore).
3. **Create passcode** (6 digits, confirm) → `POST /auth/pin/passcode/set`.
4. **Offer biometrics** (device-only setting; unlock still falls back to the passcode).
5. **Create transaction PIN** (4 digits, confirm) → `POST /auth/pin/transaction/set`. Required
   before any purchase; the backend refuses purchases with `TRANSACTION_PIN_NOT_SET` otherwise.
6. **Verify identity (optional at sign-up, required to raise limits)**: BVN and/or NIN (§7.6).
7. **Fund wallet**: show the virtual account when it exists (§9). Until then, show a
   "Funding by bank transfer is coming soon" state.

### 7.2 App lock
- On cold start or after N minutes in background: passcode screen (or biometrics) →
  `POST /auth/pin/passcode/verify`. 5 wrong attempts lock it for 5 minutes (server-side).
- "Forgot passcode" → sign out and log in again with password (no passcode-reset endpoint yet).

### 7.3 Home
`GET /dashboard/home`: name, balance, account number + bank (empty until VA exists),
totals (funded, spent, airtime count, data count), last 5 activities.
Quick actions: Airtime, Data, TV, Electricity, Send money (coming soon), Add money.

### 7.4 Buy (all purchases)
Common rules:
- Generate a **new reference per checkout** (`mob-<uuid>`), keep it for the whole attempt
  (including retries after a timeout). Same reference = same order, never charged twice.
- Ask for the 4-digit PIN on the final confirm step (PIN sheet).
- Show the outcome from `transaction.status`: `success` | `pending` | `failed`
  (`failed` with `refunded: true` means the money is back in the wallet).
- `pending` = provider hasn't confirmed; staff resolve it. Tell the user it's processing.

Flows:
- **Airtime**: network (`GET /telecom/networks` → `airtimeNetworks`), phone, amount ₦50–₦50,000.
- **Data**: network (`dataNetworks`), plan (`GET /telecom/data/plans?network=`), phone. Price = plan price.
- **Cable TV**: provider (`GET /bills/cable/providers`), plan (`GET /bills/cable/plans?identifier=`),
  smartcard/IUC → verify name (`POST /bills/cable/verify`), phone. Price = plan price.
- **Electricity**: DisCo (`GET /bills/electricity/plans`), prepaid/postpaid, meter number → verify
  name (`GET /bills/electricity/verify`), amount (≥ ₦1,000 or the DisCo's min), phone.
  On success show the **token** big with a copy button; it's also kept in order history.

### 7.5 Activity
- Wallet history: `GET /wallets/transactions`, detail `GET /wallets/transactions/:id`.
- Orders (purchases with delivery status, tokens): `GET /orders`, `GET /orders/:id`.

### 7.6 Identity (KYC)
`GET /user/me/verification` → tier + BVN/NIN status.
- **BVN**: BVN (11 digits) + a bank account opened with that BVN: bank from `GET /user/banks`
  (6-digit NIBSS codes) + 10-digit account number. The backend checks that the account belongs
  to the BVN and that the account name matches the Wymlink name.
- **NIN**: 11 digits; always reviewed by staff for now.
- Statuses: `NONE` (not submitted), `PENDING` (under review), `VERIFIED`, `FAILED` (+ `reason`).

### 7.7 Security settings
- Change PIN (current + new), Forgot PIN (email code → new PIN), PIN lock state.
- Change passcode, toggle biometrics.
- Sign out (revokes this device's session).

### 7.8 Profile & help
- Profile: name (editable only before KYC), email/phone (can only *add* a missing one; changes go
  through "Request a change" = account-update request).
- Support tickets: list + create.
- Limits screen: from `GET /user/me` → `user.limits`.

### 7.9 Send money (UI can be built now, wired later — §9)
Bank list → account number → resolved name → amount + narration → fee shown → PIN → status.

---

## 8. API reference (built endpoints)

Base: `https://wymlink-backend.onrender.com/api/v1`. JSON in and out.
Authenticated routes need `Authorization: Bearer <accessToken>`.

### 8.1 Errors
Every error has this shape:
```json
{ "success": false, "error": { "code": "SOME_CODE", "message": "Human readable", "details": {} } }
```
Show `error.message` to the user unless you have a better screen for the code.

| HTTP | code | Meaning / app action |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Bad input (`details` = zod field errors) or a business rule message |
| 400 | `INSUFFICIENT_BALANCE` | Offer "Add money" |
| 400 | `INVALID_CODE` | Wrong/expired email code |
| 401 | `UNAUTHORIZED` | Access token missing/expired → refresh once, then log out |
| 403 | `ACCOUNT_INACTIVE` | Account suspended → log out, show support contact |
| 403 | `TRANSACTION_PIN_NOT_SET` | Send to Create PIN |
| 403 | `INVALID_TRANSACTION_PIN` | Wrong PIN |
| 403 | `BVN_VERIFICATION_REQUIRED` | Over the tier-0 limit → send to Identity |
| 403 | `LIMIT_EXCEEDED` | Over tier limit (`details`: tier, singleMax, dailyMax, spentToday) |
| 404 | `NOT_FOUND` | |
| 409 | `TRANSACTION_PIN_ALREADY_SET` | Use Change PIN instead |
| 429 | `TRANSACTION_PIN_LOCKED` | `details.lockedUntil` (ISO) → show countdown / reset PIN |
| 401 | `INVALID_PASSCODE` | Wrong app passcode — **don't** sign out (unlike `UNAUTHORIZED`) |
| 429 | `PASSCODE_LOCKED` | `details.lockedUntil` → show countdown |
| 429 | `RATE_LIMITED` | Too many attempts, wait |
| 503 | `SERVICE_UNAVAILABLE` | Feature not live yet (payouts) or provider not configured |
| 500 | `INTERNAL_SERVER_ERROR` | Generic retry message |

### 8.2 Auth & sessions
| Method & path | Body | Response |
|---|---|---|
| `POST /auth/signup` | `{firstName, lastName, email?, phone?, password, client:"mobile", deviceId}` | 201 `{user:{id,role}, accessToken, refreshToken, accessTokenExpiresInSeconds, refreshTokenExpiresInSeconds}` |
| `POST /auth/login` | `{email? , phone?, password, client:"mobile", deviceId}` | 200 same as signup |
| `POST /auth/refresh` | `{refreshToken}` | 200 `{accessToken, accessTokenExpiresInSeconds}` (refresh token is not rotated) |
| `POST /auth/logout` | `{refreshToken}` | 204 |
| `POST /auth/password/forgot` | `{email}` | 200 `{ok:true}` (same answer whether or not the email exists) |
| `POST /auth/password/reset` | `{email, code, newPassword}` | 200 `{ok:true}`; signs out every device |

- Phone can be typed as `0803…`, `803…`, `234803…` or `+234 803 …`; stored as `+2348031234567`.
- Email is case-insensitive.
- Access token: 1 hour. Refresh token: **30 days for `client:"mobile"`** (`MOBILE_REFRESH_TOKEN_TTL_SECONDS`), 24 h for web.
  The app must require the passcode/biometrics on every open.
- Staff accounts can't log in here (admin console only).
- Rate limits: login 10 / 15 min per IP+account; sign-up 10 / hour per IP; password reset 10 / 15 min.

Token handling in the app: keep both tokens in SecureStore; on 401 call `/auth/refresh` once
(single-flight), retry the request, and on a second 401 clear tokens and go to login.

### 8.3 PIN & passcode
| Method & path | Body | Response |
|---|---|---|
| `GET /auth/pin/status` | — | `{transactionPinSet, passcodeSet, lockedUntil}` |
| `POST /auth/pin/transaction/set` | `{pin:"1234"}` | 201 `{ok:true}`; 409 if already set |
| `POST /auth/pin/transaction/change` | `{currentPin, newPin}` | 200 `{ok:true}` |
| `POST /auth/pin/transaction/reset/request` | `{email}` | 200 `{ok:true}` (emails a 6-digit code, 10 min) |
| `POST /auth/pin/transaction/reset/confirm` | `{email, code, newPin}` | 200 `{ok:true}` |
| `POST /auth/pin/passcode/set` | `{passcode:"123456"}` | 201 `{ok:true}`; 400 if already set |
| `POST /auth/pin/passcode/verify` | `{passcode}` | 200 `{ok:true}`; 401 `INVALID_PASSCODE`; 429 `PASSCODE_LOCKED` |
| `POST /auth/pin/passcode/change` | `{currentPasscode, newPasscode}` | 200 `{ok:true}` |

Lockout: 5 wrong PINs → locked 5 min (`TRANSACTION_PIN_LOCKED`); same for passcode.
Email codes: 6 digits, 10 min, 5 guesses, 1 per minute.

### 8.4 Profile, limits, support
| Method & path | Body | Response |
|---|---|---|
| `GET /user/me` | — | `{user}` (below) |
| `PATCH /user/me` | `{firstName?, lastName?, email?, phone?}` | `{user}` |
| `POST /user/account-update-requests` | `{requestedFields:{firstName?, lastName?, email?, phone?, reason?}}` | 201 `{request}` |
| `GET /user/account-update-requests` | — | `{requests}` |
| `POST /user/support-tickets` | `{subject (3–120), message (1–5000)}` | 201 `{ticket}` |
| `GET /user/support-tickets` | — | `{tickets:[{id, subject, status, message, messages:[{id, body, fromCustomer, createdAt}], createdAt}]}` |

`user` object:
```json
{ "id": "uuid", "firstName": "Ada", "lastName": "Obi", "email": "ada@x.com", "phone": "+2348031234567",
  "emailVerified": false, "phoneVerified": false, "role": "customer", "status": "active",
  "kycTier": 0, "countryCode": "NG", "currencyCode": "NGN",
  "transactionPinSet": true, "passcodeSet": true, "createdAt": "…",
  "limits": { "tier": 0, "label": "Unverified", "singleMax": "10000.00", "dailyMax": "10000.00", "balanceMax": "50000.00" } }
```
Profile rules: names are locked once `kycTier > 0`; email/phone can only be added when missing.

### 8.5 Identity (KYC)
| Method & path | Body | Response |
|---|---|---|
| `GET /user/me/verification` | — | `{tier, bvn:{status, verifiedAt, masked, reason}, nin:{…}}` |
| `GET /user/banks` | — | `{banks:[{code:"000013", name:"Guaranty Trust Bank (GTBank)"}, …]}` |
| `POST /user/me/verification/bvn` | `{bvn, bankCode (6-digit), accountNumber (10-digit)}` | same as GET |
| `POST /user/me/verification/nin` | `{nin}` | same as GET |

Rate limit: 5 submissions / hour per user. `masked` = `*******1234`.
Failure reasons: `name_mismatch`, `account_not_linked_to_bvn`, `already_linked`, `rejected_by_review`.

### 8.6 Wallet & history
| Method & path | Response |
|---|---|
| `GET /wallets/me` | `{balance:"15800.00", currency:"NGN", status:"active", accountNumber:null, bankName:null, reservedAccount:null}` |
| `GET /wallets/transactions?limit=50` | `{transactions:[LedgerRow]}` |
| `GET /wallets/transactions/:id` | `{transaction: LedgerRow}` |
| `GET /dashboard/home` | see below |
| `GET /orders?limit=50` | `{orders:[Order]}` |
| `GET /orders/:id` | `{order: Order}` |

Money amounts are **strings with 2 decimals** (`"1500.00"`), except `/dashboard/home` which uses numbers.
Parse with care; never use floats for arithmetic you send back.

`LedgerRow`:
```json
{ "id": "uuid", "transactionType": "purchase", "direction": "debit", "amount": "300.00",
  "balanceBefore": "19600.00", "balanceAfter": "19300.00", "referenceCode": "vtu:<orderId>",
  "relatedType": "vtu_order", "relatedId": "uuid", "description": "1GB 30 days data to 08031234567",
  "status": "success", "createdAt": "…" }
```
`transactionType` ∈ `deposit, purchase, payout, fee, refund, reversal, transfer_in, transfer_out, adjustment`.

`/dashboard/home`:
```json
{ "user": {"id","fullName","email","phone"},
  "wallet": {"balance": 15800, "currency": "NGN", "accountNumber": "", "bankName": ""},
  "analytics": {"totalFunded": 0, "totalSpent": 4200, "airtimePurchases": 1, "dataPurchases": 1},
  "recentTransactions": [{"id","source":"wallet|telecom","transactionType","amount":100,"status":"success|pending|failed","timestamp"}] }
```

### 8.7 Purchases
Catalogue (Peyflex data passed through):
| Method & path | Auth | Response |
|---|---|---|
| `GET /telecom/networks` | yes | `{airtimeNetworks:[{id, name}], dataNetworks:[{identifier, name}]}` |
| `GET /telecom/data/plans?network=<identifier>` | yes | `{network, plans:[{plan_code, amount, label?/display?/name?}]}` |
| `GET /bills/cable/providers` | no | `{providers:[{identifier, name}]}` |
| `GET /bills/cable/plans?identifier=` | no | `{plans:[{plan_code, amount, display?/description?}]}` |
| `POST /bills/cable/verify` | yes | body `{identifier, iuc}` → `{customer_name?, status?, message?}` |
| `GET /bills/electricity/plans` | no | `{plans:[{plan_code (or plan_id), plan_name, min_amount?, max_amount?}]}` |
| `GET /bills/electricity/verify?meter=&plan=&type=prepaid|postpaid` | yes | `{customer_name?, status?, message?}` |

Buying (all need `transactionPin`; `internalReference` 8–128 chars of `A-Z a-z 0-9 _ - : .`):
| Method & path | Body |
|---|---|
| `POST /telecom/airtime/purchase` | `{internalReference, network, amount (int 50–50000), mobileNumber, transactionPin}` |
| `POST /telecom/data/purchase` | `{internalReference, network, planCode, mobileNumber, transactionPin}` |
| `POST /bills/cable/subscribe` | `{internalReference, identifier, plan, iuc, phone, transactionPin}` (any `amount` sent is ignored) |
| `POST /bills/electricity/subscribe` | `{internalReference, meter, plan, amount, type, phone, transactionPin}` |

All return 200 `{transaction: Order}` even when the provider fails — read `status`.
Rate limit: 10 purchases / minute per user; 20 name look-ups / minute.

`Order`:
```json
{ "id": "uuid", "reference": "mob-…", "product": "electricity", "provider": "peyflex",
  "service": "ikedc", "planCode": null, "planName": "Ikeja Electric", "recipient": "45012345678",
  "recipientName": "METER OWNER", "meterType": "prepaid", "amount": "1000.00",
  "status": "success", "orderStatus": "success", "refunded": false,
  "token": "1234-5678-9012-3456-7890", "units": "45.6", "lastError": null,
  "providerResponse": {"token": "…", "units": "…"}, "createdAt": "…", "completedAt": "…" }
```
- `status` (show this): `success` | `pending` | `failed`.
- `orderStatus` (internal): `processing | success | failed | refunded | unknown`.

### 8.8 Payouts (not live)
`GET /payouts/banks`, `GET /payouts/validate-account`, `POST /payouts`,
`GET /payouts/status/by-reference`, `GET /payouts/:id` → all **503 `SERVICE_UNAVAILABLE`**
("Bank transfers are coming soon.") until §9 is built.

### 8.9 Not for the app
`/admin/*` (staff console, separate login with 8-hour sessions), `/system/*` (staff only),
`/training/register` (website course sign-up).

---

## 9. Not built yet: Moneta (virtual accounts, deposits, payouts)

**Provider:** Moneta (moneta.ng). WymNet has its own Moneta partner account; the owner is still
collecting the credentials. Nothing below exists yet except the database tables and the shared
Moneta HTTP/token helper (`src/modules/moneta/moneta.http.ts`).

### 9.1 What Moneta provides (from the Etico integration)
- **Partner VA API** `https://app.moneta.ng/api/v1/partner/…`
  - token: `GET /partner/auth/access-token` with `Authorization: Basic base64(clientId:clientSecret)`,
    then `Authorization: Bearer <token>`. **Only one live token at a time** per credential set
    (shared via `app.provider_tokens`, already implemented in `moneta.http.ts`).
  - `POST /partner/virtual-accounts` (create), `GET …/virtual-accounts/account-balance?virtual_account_reference=`,
    `GET …/transaction-histories`, `POST …/transfer` (VA → VA), `GET …/transfer-histories`,
    `POST …/payout` (VA → any bank), `GET …/payout-histories`, `GET …/banks`,
    `GET …/account/resolve?account_number=&bank_id=` (name enquiry).
- **BVN API** `https://api.moneta.ng/api/v2/bvn/*` (account identity check — built; OTP flow — not built).
- Requirements / quirks:
  - **Calls only from a whitelisted IP.** Moneta can't whitelist 54.195.3.54 for WymNet (Etico already uses it),
    so WymNet asked for **54.217.142.99** (Fixie, EU West; Fixie IPs are shared with other Fixie customers). All Moneta calls go through Fixie via `MONETA_PROXY_URL`. Fixie sends traffic
    from two IPs (54.195.3.54 and 54.217.142.99) at random; a call that leaves from the non-whitelisted one is rejected
    by Moneta with "Ip address not whitelisted" (`responseErrorCode` 03) *before processing*, so
    `monetaFetch` re-sends it (up to 8 times) — the same approach Etico uses. Free Fixie plan:
    500 requests / month (retries count), so deposit checks must be on demand, not constant polling.
    Long term: WymNet's own VPS with one static IP.
  - Responses can take ~20 s. Use long timeouts (≥ 60 s) and never retry a money call blindly.
  - **Payment notifications (webhook)**: Moneta will POST deposit notifications to
    `https://wymlink-backend.onrender.com/api/v1/webhooks/moneta`. The receiver (`src/modules/moneta/moneta.webhook.ts`)
    currently only **records** them in `app.provider_events` and answers 200; nothing is credited until Moneta's
    signature scheme and payload format are known. Credit only after verifying the signature **and** confirming the
    credit in Moneta's transaction history.
  - **Payout fee is charged on top** of the amount, from the source VA.
  - Amounts can come back as text with thousands commas (`"1,990.00"`).

### 9.2 Planned design (backend)
- One active VA per wallet (`app.virtual_accounts`, `provider='moneta'`), created after sign-up
  (or after BVN if Moneta requires it — confirm with Moneta).
- Worker (`PROCESS_ROLE=worker|all`) polls each VA's history; each new credit becomes a row in
  `app.deposits` (unique per provider reference) and is credited with `app.post_entry`
  (`entry_type='deposit'`). Credits above the tier's `balance_max` → `held_for_review`.
- Payouts: name enquiry → `app.payouts` row + debit (amount + fee) in one transaction → one
  Moneta payout call → success / failed (reverse) / unknown (staff resolve), same pattern as
  purchases (`src/modules/vtu/vtu.service.ts`).
- Wymlink-to-Wymlink transfers: ledger-only (`transfer_out` / `transfer_in`), optionally mirrored
  with a Moneta VA→VA transfer.

### 9.3 Planned API (may change; build the UI against it, behind a feature flag)
| Method & path | Notes |
|---|---|
| `GET /wallets/me` | `accountNumber`, `bankName`, `reservedAccount.accountName` filled once the VA exists |
| `POST /wallets/virtual-account` | create/return the VA (idempotent) |
| `GET /payouts/banks` | `{banks:[{code, name}]}` (code = Moneta bank id/code) |
| `GET /payouts/validate-account?bankCode=&accountNumber=` | `{accountNumber, accountName, bankCode, bankName}` |
| `GET /payouts/quote?amount=` | `{amount, fee, total}` |
| `POST /payouts` | `{reference, amount:"5000.00", bankCode, accountNumber, narration, transactionPin}` → `{reference, status}` |
| `GET /payouts/status/by-reference?reference=` | `{reference, status, providerReference}` |
| `GET /payouts/beneficiaries` | saved recipients (`app.beneficiaries`) |
| `POST /transfers` | to another Wymlink user by phone/email: `{reference, recipient, amount, transactionPin}` |

Credentials the owner will provide (names only; values go in Render):
`MONETA_PARTNER_CLIENT_ID`, `MONETA_PARTNER_CLIENT_SECRET`, `MONETA_BVN_CLIENT_ID`,
`MONETA_BVN_CLIENT_SECRET`, `MONETA_BVN_SERVICE_KEY`, optional `MONETA_PROXY_URL`.

---

## 10. Business rules the app must reflect

**KYC tiers and limits** (`app.tier_limits`, placeholders to confirm with compliance):

| Tier | Meaning | Per transaction | Per day | Max balance |
|---|---|---|---|---|
| 0 | Unverified | ₦10,000 | ₦10,000 | ₦50,000 |
| 1 | BVN **or** NIN verified | ₦50,000 | ₦50,000 | ₦300,000 |
| 2 | BVN **and** NIN verified | ₦200,000 | ₦200,000 | ₦500,000 |
| 3 | Full KYC (staff only) | ₦5,000,000 | ₦5,000,000 | none |

- "Per day" = debits since midnight Lagos time; refunded purchases don't count.
- One verified BVN and one verified NIN per Wymlink account (enforced by the database).
- Purchases: price always comes from the provider's plan list (data, cable); airtime ₦50–₦50,000;
  electricity ≥ ₦1,000 (or the DisCo's min) and ≤ ₦500,000.
- An order that the provider rejects is refunded at once. An order with no clear answer stays
  `pending` and is never re-sent; staff settle it (delivered or refunded) from the admin console.

---

## 11. Security features

### 11.1 Backend (already in place)
- **Money integrity in the database**: balances change only through `app.post_entry` (locks the
  wallet, checks balance, writes the ledger line, idempotent per reference). Direct balance edits
  (`WL004`) and ledger edits/deletes (`WL005`/`WL010`) are rejected by triggers. `app.wallet_drift`
  lists any wallet whose balance disagrees with its ledger (admin dashboard shows the count; must be 0).
- **Purchase safety**: debit + order in one transaction; provider called exactly once per reference;
  replays return the original order; concurrent duplicates resolved by a unique reference.
- **Private schema + RLS**: all data in `app`, RLS on with no policies, so Supabase's public API
  keys can't read or write anything.
- **Passwords, PIN, passcode, OTP codes**: bcrypt (cost 12; OTP 10). Constant-time login (dummy hash
  for unknown accounts). No account discovery on forgot-password/PIN.
- **Lockouts**: PIN and passcode 5 tries → 5 min lock (atomic counter); OTP 5 guesses per code,
  1 code per minute, 10-minute expiry, single use.
- **PIN can't be overwritten** with a stolen session: set only once; change needs current PIN;
  reset needs an email code.
- **Sessions**: per device (`web` / `mobile` / `admin`), refresh tokens stored hashed, revocable with a
  reason; password reset and account suspension revoke all sessions; suspended accounts are refused
  within 30 s even with a valid access token.
- **KYC privacy**: BVN/NIN never stored — only an HMAC (`KYC_HASH_SECRET`) and the last 4 digits.
  BVN name match uses the profile name, never a name typed into the form.
- **Profile changes** can't redirect account recovery (no direct email/phone replacement; names
  locked after KYC).
- **Rate limits** (JSON errors) on login, sign-up, resets, PIN/passcode, KYC, purchases, look-ups, and
  a global per-IP limit. Correct client IPs behind Render (`TRUST_PROXY_HOPS=1`).
- **Admin**: separate login, 8-hour sessions, role permissions (super/business/finance admin),
  every sensitive action in the append-only `app.audit_log`; last super admin can't be removed.
- Helmet security headers, CORS closed in production (native apps aren't affected by CORS).

### 11.2 Mobile app (must implement)
- Tokens and `deviceId` in **SecureStore** only; wipe on logout and on `ACCOUNT_INACTIVE`.
- **App lock** with the 6-digit passcode (server-verified) or biometrics; lock after inactivity
  and on app switch for sensitive screens.
- Hide sensitive screens in the app switcher / block screenshots on PIN, passcode, token and
  account screens (`expo-screen-capture`).
- PIN entry with a custom keypad (no system keyboard, no autofill, no logging).
- Never log tokens, PINs, BVN/NIN, or full responses in production builds.
- HTTPS only; consider certificate pinning later.
- One `internalReference` per checkout, reused on retry; disable the Pay button while in flight.
- Show amounts from the server's strings; don't do money math in floats.
- Root/jailbreak detection is optional (a warning is enough for v1).

---

## 12. How to test without spending money

The previous session tested the whole backend with a **fake Peyflex** and the real Supabase:
- Mock server answers airtime by amount: ₦100 → success, ₦200 → HTTP 400 (rejected),
  ₦300 → HTTP 502 (unknown); plus plans, cable, electricity (returns a token).
- Run the backend locally with `PEYFLEX_BASE_URL=http://localhost:4590 PEYFLEX_API_TOKEN=test`.
- Fund a test wallet with SQL: `select app.post_entry(<wallet_id>, 'credit', 20000, 'adjustment', 'test:fund:1', 'Test funding');`
- Use `@test.wymlink.dev` emails. The ledger is append-only, so test data is removed by rebuilding
  the empty schema (only when every account is a test account).
- Result on 2026-10-26: **58/58 checks passed** (sign-up, sessions, PIN, passcode, all purchase
  outcomes, replay safety, limits, KYC, admin review/refund, drift = 0, suspension).

For the mobile app: point it at a local backend with the fake provider for purchase flows; use the
live backend only for read-only screens and auth.

---

## 13. Known gaps and next steps

1. **Moneta module** (VA, deposit polling, payouts, banks, name enquiry, transfers, BVN OTP) — needs
   WymNet's Moneta credentials and the IP whitelist (§9).
2. **Refresh-token rotation** with reuse detection (`sessions.previous_token_hash` already exists). Mobile sessions already last 30 days.
3. Passcode reset by email code (`otp_codes.purpose='reset_passcode'` is ready in the DB).
4. Email/phone verification at sign-up (`verify_email` / `verify_phone`).
5. Push notifications (deposits, purchase outcomes) — needs a device-token table.
6. Website follow-ups: KYC form must use `GET /user/banks` (6-digit codes) and the new status
   values (`NONE`/`PENDING`/`VERIFIED`/`FAILED`); payouts page shows "coming soon".
7. API docs page (`/docs`, `src/core/docs/openapi.ts`) still lists old Monnify endpoints — regenerate.
8. Tier limits are placeholders — confirm with WymNet compliance.
9. Admin 2FA (recommended before launch).
10. Render free plan sleeps; WymNet will move to its own VPS (static IP for Moneta) when they pay.
