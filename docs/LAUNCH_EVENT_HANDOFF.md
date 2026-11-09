# Wymlink launch event: handoff for testing

Written 2026-11-09, ~23:45 Lagos, the night before the event. The reader is the engineer
(or agent) who will independently re-test everything below before 09:00 and fix what isn't
right. Take your time: the goal is no surprises on stage.

## TL;DR

- **2026-11-10, 09:00 Lagos**: the owner presents Wymlink at a conference. The apps are not
  on the stores, so the **website** (https://wymlink-web.vercel.app) is the main channel; the
  Android APK is on the demo phone only.
- For one day there is a **free event**: data, airtime and the base GOtv/DStv plans are free
  for every customer, paid from WymNet's Peyflex wallet, with per-customer limits and a kill
  switch in the admin console.
- The owner will **demo QR payments**: the Wymlink app scans a WymNet business's QR code
  and pays into that business's account.
- Everything is built, deployed and tested locally (live-like database latency, a real proxy)
  and partly on live (no money moved). What is **not** yet proven on live is listed in §4.
- **Do not deploy the backend or website during the event** (a Render deploy restarts the
  server).

## 1. What the owner asked (2026-11-09)

1. "Get rid of the use BVN and NIN to get a virtual account, issue one to every user
   immediately after sign up."
2. A one-day promo: customers buy **GOtv, DStv, data** (and airtime) directly with Peyflex
   **without needing anything in their account**, "everything they buy will be on us",
   with limits per user during the event: **data up to ₦8,000, airtime up to ₦5,000, GOtv/DStv
   only the base (lowest) plans**. An **off switch / kill switch** on the admin dashboard, and
   a **small popup on login** explaining the event.
3. Replace the domain with the website (the owner has registrar access), since the app
   didn't make the app stores in time.
4. QR codes are **not customer-to-customer**: each WymNet Data Solutions business gets a
   dedicated QR that customers scan to pay. Create **2 QR code payments attached to 2 virtual
   accounts** in the dashboard; demo: the app scans a QR, the payment goes into that
   company's virtual account.
5. "Make the user and the VA have a unique ID and attach it to the name of the virtual account."
6. Test enough before an EAS build; clean up the website dashboard, functional and mobile
   responsive.
7. Later: "go back again and don't stop until you're completely sure it's ready."
8. Latest: "add the user's name into the ID too, just the display on the account", plus this
   handoff.

## 2. What was built

### Backend: `dev-wymnet/WYMLINK-BACKEND`, branch `main` (auto-deploys to Render)

- **Account numbers at sign-up, no BVN/NIN** (`modules/banking/account.service.ts`,
  `modules/auth/service/auth.service.ts`): sign-up creates the customer ID, then opens the
  Moneta account in the background (Moneta's documented placeholder BVN `00000000000`, as
  Etico does in production, or a verified BVN if one is kept). `GET /wallets/virtual-account`
  answers `{account}` or `{account: null, setup: "opening"}`; asking also retries a failed
  opening (lease: at most once per customer per 5 minutes). `POST /wallets/virtual-account`
  needs no body. BVN/NIN verification now only raises limits.
- **Customer ID** (`users.customer_code`, "WL" + 6 digits; migration 0010): shown in
  `/user/me` and `/dashboard/home`; it is Moneta's `account_name`, so banks show
  "MONETA TECH(WYMNET-WL417731)". If Moneta ever refuses digits there, the ID is spelt in
  letters (0→A … 9→J) from then on (`moneta.partner.ts`, `createVirtualAccount`).
- **Display name with the customer's name** (latest): customer-facing endpoints show
  "MONETA TECH(WYMNET-WL417731 ADA LOVELACE)" (`displayAccountName` in `account.service.ts`).
  Display only: Moneta's stored name (and what banks show) is unchanged; admin views keep the
  raw name.
- **Free event** (`modules/promo`, migrations 0010 + 0011): `GET /promo/current` →
  `{event, mine}`. Purchases sent with `promo: true` (airtime, data, cable) are free: no wallet
  debit, `vtu_orders.promo_event_id` set, refused with 400 `PROMO_UNAVAILABLE` (never charged)
  when not covered. Allowances per customer **and** per recipient (phone / smartcard): data,
  airtime (naira totals), TV (listed plan codes, N per provider). Optional budget.
  Concurrency: customer and recipient advisory locks, one usage query, then
  `commitPromo` updates the event's running total (`promo_events.committed`) last, re-checking
  the budget and that the event is still on. A failed free order closes as `refunded` with no
  ledger entry and gives its share back (`releasePromo`). Collections never count free orders.
  Staff: `/admin/promo` (start/edit: super admin; `POST /admin/promo/:id/end`, the kill switch:
  any staff). Default TV plans: `gotv-easy` (₦4,000) and `dstv-starter36` (₦6,000): DStv's
  cheaper items on Peyflex are add-ons, not base packages.
- **WymNet businesses** (`modules/business`): internal accounts (role `business`, can't sign
  in) with a wallet, a Moneta account number named after the business, and a fixed 6-character
  code. QR content: `https://<site>/pay/<CODE>`. `GET /businesses/:code` (public),
  `POST /businesses/:code/pay {amount, transactionPin, reference}` = an ordinary Wymlink
  transfer, sent `quick` (no Moneta balance pre-check: one Moneta call, ~26 s, instead of two).
  Staff: `/admin/businesses` (create/open account/pause: super admin).
- **Real client IPs** (`core/middleware/clientIp.ts`): on Render `req.ip` was an internal 10.x
  address for everyone (Cloudflare → balancer → local proxy); it now uses Cloudflare's
  `CF-Connecting-IP` when `req.ip` is internal. Website visitors additionally need
  `BFF_SHARED_SECRET` set (same value) on Render and Vercel.
- **Rate limits** (`core/middleware/rateLimits.ts`, `apiLimiter`): signed-in traffic counted
  per access token (100/min) with a per-IP ceiling of 3,000/min; anonymous 300/min per IP;
  sign-up 600/h per IP; failed logins 200/15 min per IP (the per-account lockout still applies).
- **Moneta lanes** (`modules/moneta/moneta.http.ts`): two proxy tunnels pinned to the
  whitelisted Fixie entry server: *main* (money, balances, deposits, token) and *background*
  (account openings), so a burst of sign-ups can't hold up a payment.
- **bcrypt cost 10** for customer passwords, PINs and passcodes (`core/auth/hashCost.ts`);
  staff stay at 12. Every PIN-approved payment runs one comparison.
- **Deposit checks**: only from the deposits list, at most every 10 minutes per customer
  (each Moneta call spends proxy quota); Moneta's notifications credit the rest.

Tonight's backend commits: `00670f93` (main feature set), `3c5528be` (client IPs),
`2d347f6f`, `69babc15` (docs), `05095501` (promo locks + migration 0011), `909c0f3a`
(bcrypt), `18f129b0` (Moneta lanes), `568d8fe3` (quick business payments), then the display
name + this handoff + `e2e/`. API notes for the apps: `docs/MOBILE_HANDOFF.md` §0.

### Website: `dev-wymnet/WYMLINK-WEB`, branch `main` (Vercel). Push to the `web` remote only.

- Event popup (once per browser session per event), dashboard banner with what's left, free
  switch on Airtime/Data (on by default) and the free base plan on Cable TV; "You pay: Free, on
  Wymlink" at the PIN step; free orders listed as "Free" in history (`components/app/event.tsx`).
- `/pay/[code]`: where a business QR leads; signed out → sign in / create account → back to
  the pay page (`?next=` kept through sign-up and onboarding).
- Onboarding is PIN only; Add money shows the account number, the account name and the
  customer ID; "being set up" while the account opens (`components/app/account_pending.tsx`).
- Admin console: **Free event** page (start with allowances and budget, live totals and
  purchases every 10 s, red "End event now") and **Businesses** page (create, account number,
  QR modal with poster download and print, payments, pause).
- Fix: modals no longer pull focus back on every render (PIN boxes kept losing focus after
  each digit, `components/app/ui.tsx`).
- Proxy routes may run 60 s (`maxDuration`), since bank calls take 20–30 s.
- Commits: `2465e85`, `2ca68d5`, `a8bcc47`.

### Mobile app: `C:\Users\IMPULSE\Desktop\WYMLINK MOBILE` (no git remote; EAS builds)

- Event popup on Home (once per app launch), Home banner, free switch on Airtime/Data, free base
  plan on Cable TV (`src/features/promo/Promo.tsx`).
- **Scan to pay** (`src/app/(app)/qr/index.tsx`): reads the business QR (or a typed code) and
  opens `src/app/(app)/business/[code].tsx` (amount → PIN → "Paid <business>"). The old
  customer-to-customer QR screens are removed.
- No BVN/NIN anywhere on the way to an account number; customer ID on Account details.
- APK: `C:\Users\IMPULSE\Desktop\Wymlink-test.apk`, EAS build
  `e6bc2d10-ef1a-40eb-98a9-ad907086e76f`. The display-name change comes from the backend: no
  rebuild needed.

## 3. Live state (as of writing)

- Backend live with all commits above; migrations 0001–0011 applied on the live database.
- **No event has been started on live and no businesses exist yet**: the owner creates them.
- Two **live test customers** were created to prove sign-up → account opening (no money):
  `launch.test.720061@wymnet.org` (WL417731, 9650565545) and
  `launch.test2.873246@wymnet.org` (WL554888, 9648404229). Safe to disable.
- Measured on live: Moneta calls **~26 s each** through Fixie (even warm); database
  ~65–150 ms per query from Render (DB in eu-west-1, session pooler, app pool 10, Postgres
  max_connections 60); 60 simultaneous dashboard loads ~8 s each (all succeeded); sign-up
  1.6 s, sign-in 0.9 s; account number opens 50–70 s after sign-up.
- **Peyflex wallet: ₦12,843** after the last purchase (2026-11-02). One customer can use up
  to ~₦23,000 of free items. Must be topped up before 09:00.
- Render is on the **free plan** (sleeps after 15 min idle, ~50 s wake). A keep-alive is
  pinging `/health` every 4 minutes from the owner's PC until ~18:00 on 2026-11-10 (only while
  that PC is on).

## 4. What has been verified, and what hasn't

**Local** (see `e2e/README.md`; database behind a live-like 66 ms round trip):

- `e2e-event.mjs` 78/78; `e2e-concurrency.mjs` 17/17 (30 customers at once all delivered in
  ~4 s; budget, shared recipient and kill switch exact under a rush; running total always equals
  the orders); `e2e-lanes.mjs` 6/6 (QR payment in ~2 s while five slow account openings were
  queued); `e2e-digits.mjs` pass.
- Website in a phone-sized browser: sign-up → PIN → popup → free data → history "Free" → TV
  free plan → pay page; new attendee from a QR → sign-up → back on the pay page; admin Event
  page, Businesses page, QR poster downloads and decodes to the pay link.
- App (web build): sign-up → passcode → PIN → popup → free data → Scan to pay (typed code) →
  ₦500 → "Paid".

**Live** (read-only or account creation only):

- Sign-up → customer ID → account number opens through the background lane (two accounts).
- Moneta through Fixie on the main lane (a bank name lookup returned "MONETA TECH(WYMNET-…)").
- Live website as a signed-in customer: dashboard, Add money (account number, account name,
  customer ID), unknown pay code page, admin sign-in page; no errors, no sideways scroll.
- Client IPs now real; rate limits per token.

**Not verified on live** (needs real money or the owner's admin login + authenticator):

1. A free purchase through Peyflex (start an event with a small budget, buy ₦100 airtime free,
   end the event).
2. A QR payment through Moneta: **no VA-to-VA transfer has ever run on this live system**. The
   request matches Moneta's docs and Etico's production code (`/partner/virtual-accounts/transfer`,
   `{source_virtual_account, destination_virtual_account, amount}`), but the first real one
   should be the owner's ₦100 rehearsal tonight, not the stage demo.
3. The admin Free event and Businesses pages on live.
4. The display name with the customer's name on live (deployed with this handoff; check it
   with any customer account).

## 5. Suggested test plan

1. Re-run the local kit (`e2e/README.md`): the API suites, then the website and app checks.
2. Read the critical paths with fresh eyes: `promo.service.ts` (`claimPromo`, `commitPromo`,
   `releasePromo`), `vtu.service.ts` (`placeOrder`, `refundOrder`), `business.service.ts`
   (`payBusiness`), `transfer.service.ts` (`createTransfer`, `quick`), `moneta.http.ts` (lanes,
   IP retries), `clientIp.ts`, `rateLimits.ts` (`apiLimiter`), `account.service.ts`
   (`issueAccount`, `createAndStore`, `displayAccountName`).
3. Think through tomorrow's failure modes and what the customer sees in each:
   - Peyflex out of money: orders fail; the customer sees "failed", nothing is charged.
   - Peyflex slow or unclear: the order is `unknown`, still counted against allowances; staff
     resolve it in Admin → Bills.
   - Moneta slow (~26 s per call); the app times out at 60 s.
   - Fixie quota used up: account openings and QR payments fail.
   - Render restarts mid-event.
   - The kill switch pressed during purchases.
   - A venue Wi-Fi putting everyone behind one IP.
4. Only with the owner's explicit OK (real money): the event rehearsal and the ₦100 QR
   rehearsal in §6.
5. Report clearly what passed, what failed and what you changed; push fixes only after the
   local suites pass, and **never during the event**.

## 6. The owner's checklist (tonight, before 09:00)

1. **Top up the Peyflex wallet** (it pays every free purchase).
2. **Check Fixie usage and upgrade the plan**: the free plan allows 500 requests a month (billed
   per tunnel); if it runs out, account openings and QR payments stop.
3. **Upgrade Render to a paid instance** (no sleeping, more CPU).
4. **Set `BFF_SHARED_SECRET`** to the same value on Render and Vercel (a value was given to the
   owner in chat; any 64-character random string works).
5. **Create the two businesses** (Admin → Businesses → Add) → Show QR code → Download poster or
   Print.
6. **Install the new APK** on the demo phone; **add money** to the owner's own Wymlink account
   (₦300.50 now; deposits have taken up to an hour to land at Moneta); **pay ₦100 to one business
   with Scan to pay** (expect ~30 s).
7. **Rehearse the event**: start with a small budget, buy ₦100 airtime free on the website,
   press End event now.
8. Domain (optional): Vercel → Settings → Domains → add it; set the exact A/CNAME records Vercel
   shows at the registrar (do not touch MX/TXT: email runs on wymnet.org); set
   `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_BASE_URL` on Vercel; redeploy.
   `wymlink-web.vercel.app` keeps working throughout.

## 7. Event-day runbook

- **08:30**: open https://wymlink-backend.onrender.com/api/v1/health (wakes the server if it
  slept); sign in to the console (https://wymlink-web.vercel.app/admin).
- **09:00**: Admin → **Free event** → **Start the event now**. Allowances are prefilled (data
  ₦8,000, airtime ₦5,000, GOtv Easy, DStv Starter, 1 per provider). Set **Budget** to the
  Peyflex top-up minus a buffer.
- **During**: the Free event page refreshes every 10 s (given out, customers, Peyflex wallet,
  every purchase). Low Peyflex wallet → top up, lower the budget, or end the event.
- **Kill switch**: the red **End event now** (any staff member). Purchases already sent to
  Peyflex finish; nothing new starts free.
- **Stuck orders** (pending/unknown): Admin → Bills → needs attention → mark delivered or close,
  after checking Peyflex.
- **Demo**: app → Scan to pay → the poster → amount → PIN → about 30 s → "Paid <business>";
  Admin → Businesses shows the payment.
- **No deploys** of the backend or website until the event is over.

## 8. Rules

- **No real-money calls without the owner's explicit OK**: Peyflex purchases, Moneta transfers
  and payouts. Peyflex and Moneta are live.
- The backend's `.env` points at the **live** database and live Peyflex token: run anything
  local with `DOTENV_CONFIG_PATH=e2e/test.env`; on the live database, read-only queries only.
- Never print or commit secrets (KYC_HASH_SECRET, the Fixie URL, Moneta and Supabase keys).
- Commits as `WymNet Dev <dev@wymnet.org>`; **never** add Co-Authored-By Claude or "Generated
  with Claude Code" lines.
- Website: push to the `web` remote (dev-wymnet/WYMLINK-WEB); never to `origin`
  (BayoGabriel/wym_fe).
- Mobile repo: no git remote; builds with `npx eas-cli@latest build --platform android
  --profile preview`.
- Tested backend fixes may be pushed to `main` without asking, **except during the event**.

## 9. Where things are

- Backend API: https://wymlink-backend.onrender.com/api/v1 (health: `/health`)
- Website: https://wymlink-web.vercel.app · admin `/admin` · business pay page `/pay/<CODE>`
- Mail relay: https://wymlinkmail.vercel.app
- API notes for the apps: `docs/MOBILE_HANDOFF.md` §0 · local test kit: `e2e/README.md`
