# Wymlink Backend

API for the Wymlink mobile app, website and admin console (Node.js, Express, Drizzle,
Postgres on Supabase). Banking (account numbers, deposits, payouts, transfers) goes
through Moneta; airtime, data, TV and electricity through Peyflex.

## Run locally

```bash
npm install
cp .env.example .env    # fill in the values
npm run migrate         # applies db/migrations/*.sql
npm run dev             # http://localhost:3000/api/v1/health
```

`.env.example` lists every setting with a short note. The essentials are
`DATABASE_URL`, `JWT_ACCESS_SECRET` and `KYC_HASH_SECRET`; providers that aren't
configured answer "not available yet".

## Database

`db/migrations/*.sql` are the source of truth. They run in order, once each, on every
start (`entrypoint.sh` → `dist/scripts/migrate.js`), and are recorded in
`public.wymlink_migrations`. After migrating, every table in the `app` schema is locked
away from Supabase's public API roles (row-level security, no grants).

## Staff accounts

- `ADMIN_EMAIL=… ADMIN_FIRST_NAME=… ADMIN_LAST_NAME=… ADMIN_PASSWORD=… npm run admin:create`:
  creates the first super admin (refuses if one exists). Other staff are added from the console.
- `ADMIN_EMAIL=… npm run admin:reset-mfa` (or `node dist/scripts/resetAdminMfa.js` on the
  server): removes a staff member's authenticator so they set it up again at next sign-in.
- `ADMIN_MFA_REQUIRED=false`: switches the authenticator step off for everyone (e.g. while
  testers use the console). The server logs a warning at start and on every such sign-in;
  remove the setting (or set `true`) to switch it back on.

## Deploy

Render builds the `Dockerfile` from `main`. `.github/workflows/keep-awake.yml` pings
`/api/v1/health` every 10 minutes.

## More

- `docs/backend_technical_overview.md`
- `docs/MOBILE_HANDOFF.md`
- `docs/admin_api.postman.md`
