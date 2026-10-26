-- =============================================================================
-- Wymlink core schema (v1) — Supabase / PostgreSQL 15+
--
-- Design rules
--   * Everything lives in the private schema `app`. Supabase only exposes
--     `public` (and graphql_public) through its REST API, and RLS is enabled
--     with no policies on every table, so the public anon key can never read
--     or write app data. The backend connects as the owner role.
--   * Money is numeric(18,2) naira — exact, two decimals, never floats.
--   * Wallet balances change ONLY through app.post_entry(), which locks the
--     wallet, writes the ledger line and updates the balance in one step.
--     Direct balance edits and direct ledger inserts are rejected.
--   * The ledger and the audit log are append-only.
--   * Financial records are never deleted with a user (ON DELETE RESTRICT);
--     users are closed, not removed.
--   * Every status / type / role column is constrained to known values.
-- =============================================================================

create extension if not exists citext;

create schema if not exists app;
revoke all on schema app from public;
do $$
begin
  -- Supabase API roles; absent on plain Postgres.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema app from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema app from authenticated';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Shared helpers
-- -----------------------------------------------------------------------------
create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function app.forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'WL010';
end $$;

-- -----------------------------------------------------------------------------
-- Users & authentication
-- -----------------------------------------------------------------------------
create table app.users (
  id                    uuid primary key default gen_random_uuid(),
  first_name            text not null check (length(btrim(first_name)) between 1 and 100),
  last_name             text not null check (length(btrim(last_name)) between 1 and 100),
  email                 citext unique check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone                 text unique check (phone ~ '^\+[1-9][0-9]{7,14}$'),   -- E.164, e.g. +2348031234567
  email_verified_at     timestamptz,
  phone_verified_at     timestamptz,
  password_hash         text not null,
  transaction_pin_hash  text,
  passcode_hash         text,                                                -- mobile app unlock code
  role                  text not null default 'customer'
                          check (role in ('customer', 'super_admin', 'business_admin', 'finance_admin')),
  status                text not null default 'active'
                          check (status in ('active', 'suspended', 'disabled', 'closed')),
  kyc_tier              smallint not null default 0 check (kyc_tier between 0 and 3),
  reloadly_enabled      boolean not null default false,
  last_login_at         timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  closed_at             timestamptz,
  constraint users_contact_required check (email is not null or phone is not null),
  constraint users_closed_consistent check ((status = 'closed') = (closed_at is not null))
);
create index users_role_idx on app.users (role) where role <> 'customer';
create index users_created_idx on app.users (created_at desc);
create trigger users_touch before update on app.users for each row execute function app.touch_updated_at();

create table app.sessions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references app.users (id) on delete cascade,
  kind                 text not null check (kind in ('web', 'mobile', 'admin')),
  refresh_token_hash   text not null unique,
  previous_token_hash  text,               -- last rotated-out hash: reuse of it means theft → revoke session
  device_id            text,
  ip                   inet,
  user_agent           text,
  expires_at           timestamptz not null,
  last_used_at         timestamptz not null default now(),
  revoked_at           timestamptz,
  revoked_reason       text,
  created_at           timestamptz not null default now()
);
create index sessions_user_active_idx on app.sessions (user_id) where revoked_at is null;
create index sessions_previous_hash_idx on app.sessions (previous_token_hash) where previous_token_hash is not null;

create table app.pin_attempts (
  user_id          uuid not null references app.users (id) on delete cascade,
  kind             text not null check (kind in ('transaction_pin', 'passcode')),
  failed_attempts  integer not null default 0 check (failed_attempts >= 0),
  locked_until     timestamptz,
  last_failed_at   timestamptz,
  updated_at       timestamptz not null default now(),
  primary key (user_id, kind)
);
create trigger pin_attempts_touch before update on app.pin_attempts for each row execute function app.touch_updated_at();

create table app.otp_codes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references app.users (id) on delete cascade,
  purpose      text not null check (purpose in ('verify_email', 'verify_phone', 'reset_password', 'reset_transaction_pin', 'reset_passcode')),
  code_hash    text not null,
  attempts     integer not null default 0 check (attempts >= 0),
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index otp_codes_lookup_idx on app.otp_codes (user_id, purpose, created_at desc);

-- -----------------------------------------------------------------------------
-- KYC
-- BVN/NIN are never stored in plain text: the app stores an HMAC (keyed with a
-- server secret) for one-identity-per-account checks, plus the last 4 digits.
-- -----------------------------------------------------------------------------
create table app.kyc_profiles (
  user_id            uuid primary key references app.users (id) on delete restrict,
  bvn_hash           text,
  bvn_last4          text check (bvn_last4 ~ '^[0-9]{4}$'),
  bvn_status         text not null default 'none' check (bvn_status in ('none', 'pending', 'verified', 'failed')),
  bvn_verified_at    timestamptz,
  nin_hash           text,
  nin_last4          text check (nin_last4 ~ '^[0-9]{4}$'),
  nin_status         text not null default 'none' check (nin_status in ('none', 'pending', 'verified', 'failed')),
  nin_verified_at    timestamptz,
  legal_first_name   text,               -- as returned by the identity provider
  legal_last_name    text,
  date_of_birth      date,
  provider           text,               -- e.g. 'moneta'
  updated_at         timestamptz not null default now(),
  constraint kyc_bvn_verified_consistent check ((bvn_status = 'verified') = (bvn_verified_at is not null)),
  constraint kyc_nin_verified_consistent check ((nin_status = 'verified') = (nin_verified_at is not null))
);
-- One verified BVN / NIN per Wymlink account.
create unique index kyc_bvn_unique on app.kyc_profiles (bvn_hash) where bvn_status = 'verified';
create unique index kyc_nin_unique on app.kyc_profiles (nin_hash) where nin_status = 'verified';
create trigger kyc_profiles_touch before update on app.kyc_profiles for each row execute function app.touch_updated_at();

create table app.kyc_attempts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references app.users (id) on delete restrict,
  kind                text not null check (kind in ('bvn', 'nin', 'bvn_account_match')),
  outcome             text not null check (outcome in ('started', 'otp_sent', 'verified', 'failed', 'error')),
  provider            text not null,
  provider_reference  text,
  failure_reason      text,
  created_at          timestamptz not null default now()
);
create index kyc_attempts_user_idx on app.kyc_attempts (user_id, created_at desc);

-- Limits per KYC tier (naira). Values are placeholders to confirm with compliance.
create table app.tier_limits (
  tier           smallint primary key check (tier between 0 and 3),
  label          text not null,
  single_max     numeric(18,2) not null check (single_max >= 0),
  daily_max      numeric(18,2) not null check (daily_max >= 0),
  balance_max    numeric(18,2) check (balance_max >= 0),           -- null = no cap
  updated_at     timestamptz not null default now()
);
create trigger tier_limits_touch before update on app.tier_limits for each row execute function app.touch_updated_at();
insert into app.tier_limits (tier, label, single_max, daily_max, balance_max) values
  (0, 'Unverified',          10000,     10000,     50000),
  (1, 'BVN or NIN verified', 50000,     50000,     300000),
  (2, 'BVN and NIN verified',200000,    200000,    500000),
  (3, 'Full KYC',            5000000,   5000000,   null);

-- -----------------------------------------------------------------------------
-- Wallets & ledger
-- -----------------------------------------------------------------------------
create table app.wallets (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null unique references app.users (id) on delete restrict,
  currency_code      text not null default 'NGN' check (currency_code = 'NGN'),
  available_balance  numeric(18,2) not null default 0 check (available_balance >= 0),
  status             text not null default 'active' check (status in ('active', 'frozen', 'closed')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table app.wallet_ledger (
  id              uuid primary key default gen_random_uuid(),
  wallet_id       uuid not null references app.wallets (id) on delete restrict,
  user_id         uuid not null references app.users (id) on delete restrict,
  entry_type      text not null check (entry_type in ('deposit', 'purchase', 'payout', 'fee', 'refund', 'reversal', 'transfer_in', 'transfer_out', 'adjustment')),
  direction       text not null check (direction in ('credit', 'debit')),
  amount          numeric(18,2) not null check (amount > 0),
  balance_before  numeric(18,2) not null check (balance_before >= 0),
  balance_after   numeric(18,2) not null check (balance_after >= 0),
  reference       text not null unique,                 -- idempotency key: one ledger line per reference
  related_type    text check (related_type in ('deposit', 'vtu_order', 'payout', 'transfer', 'adjustment')),
  related_id      uuid,
  description     text not null,
  metadata        jsonb,
  created_at      timestamptz not null default now(),
  constraint ledger_balance_math check (
    (direction = 'credit' and balance_after = balance_before + amount) or
    (direction = 'debit'  and balance_after = balance_before - amount)
  )
);
create index wallet_ledger_wallet_idx on app.wallet_ledger (wallet_id, created_at desc);
create index wallet_ledger_user_idx on app.wallet_ledger (user_id, created_at desc);
create index wallet_ledger_related_idx on app.wallet_ledger (related_type, related_id) where related_id is not null;

-- Balances may only move inside app.post_entry (which sets app.posting = on).
create or replace function app.guard_wallet_balance() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.posting', true), 'off') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' and new.available_balance <> 0 then
    raise exception 'new wallets start at zero; use app.post_entry' using errcode = 'WL004';
  end if;
  if tg_op = 'UPDATE' and new.available_balance is distinct from old.available_balance then
    raise exception 'wallet balances change only through app.post_entry' using errcode = 'WL004';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger wallets_guard before insert or update on app.wallets for each row execute function app.guard_wallet_balance();

create or replace function app.guard_ledger_insert() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.posting', true), 'off') <> 'on' then
    raise exception 'ledger lines are written only through app.post_entry' using errcode = 'WL005';
  end if;
  return new;
end $$;
create trigger wallet_ledger_guard_insert before insert on app.wallet_ledger for each row execute function app.guard_ledger_insert();
create trigger wallet_ledger_append_only before update or delete on app.wallet_ledger for each row execute function app.forbid_change();

-- The only way money moves. Idempotent on p_reference: replaying the same
-- reference returns the original line; reusing it for a different movement fails.
-- Errors: WL001 insufficient balance, WL002 wallet not active, WL003 reference conflict.
create or replace function app.post_entry(
  p_wallet_id     uuid,
  p_direction     text,
  p_amount        numeric,
  p_entry_type    text,
  p_reference     text,
  p_description   text,
  p_related_type  text default null,
  p_related_id    uuid default null,
  p_metadata      jsonb default null
) returns app.wallet_ledger
language plpgsql as $$
declare
  w        app.wallets;
  e        app.wallet_ledger;
  new_bal  numeric(18,2);
begin
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'amount must be a positive naira value with at most 2 decimals' using errcode = 'WL006';
  end if;

  select * into w from app.wallets where id = p_wallet_id for update;
  if not found then
    raise exception 'wallet % not found', p_wallet_id using errcode = 'WL007';
  end if;

  -- Checked after the lock so concurrent replays of one reference serialise here.
  select * into e from app.wallet_ledger where reference = p_reference;
  if found then
    if e.wallet_id <> p_wallet_id or e.direction <> p_direction or e.amount <> p_amount then
      raise exception 'reference % already used for a different movement', p_reference using errcode = 'WL003';
    end if;
    return e;
  end if;

  if w.status <> 'active' and p_direction = 'debit' then
    raise exception 'wallet is %', w.status using errcode = 'WL002';
  end if;

  new_bal := case p_direction
               when 'credit' then w.available_balance + p_amount
               when 'debit'  then w.available_balance - p_amount
             end;
  if new_bal is null then
    raise exception 'direction must be credit or debit' using errcode = 'WL006';
  end if;
  if new_bal < 0 then
    raise exception 'insufficient balance' using errcode = 'WL001';
  end if;

  perform set_config('app.posting', 'on', true);
  update app.wallets set available_balance = new_bal where id = p_wallet_id;
  insert into app.wallet_ledger (wallet_id, user_id, entry_type, direction, amount, balance_before, balance_after,
                                 reference, related_type, related_id, description, metadata)
  values (p_wallet_id, w.user_id, p_entry_type, p_direction, p_amount, w.available_balance, new_bal,
          p_reference, p_related_type, p_related_id, p_description, p_metadata)
  returning * into e;
  perform set_config('app.posting', 'off', true);
  return e;
end $$;

-- Debits counted against today's limit (Lagos calendar day).
create or replace function app.debits_today(p_user_id uuid) returns numeric
language sql stable as $$
  select coalesce(sum(amount), 0)::numeric(18,2)
  from app.wallet_ledger
  where user_id = p_user_id
    and direction = 'debit'
    and entry_type in ('purchase', 'payout', 'transfer_out', 'fee')
    and created_at >= (date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos')
    and not exists (                     -- refunded/reversed purchases don't count
      select 1 from app.wallet_ledger r
      where r.user_id = p_user_id and r.direction = 'credit' and r.entry_type in ('refund', 'reversal')
        and r.related_type = wallet_ledger.related_type and r.related_id = wallet_ledger.related_id
    );
$$;

-- Any row here is a bug: the wallet balance disagrees with its ledger.
create view app.wallet_drift as
select w.id as wallet_id, w.user_id, w.available_balance,
       coalesce(sum(case l.direction when 'credit' then l.amount else -l.amount end), 0) as ledger_balance
from app.wallets w
left join app.wallet_ledger l on l.wallet_id = w.id
group by w.id
having w.available_balance <> coalesce(sum(case l.direction when 'credit' then l.amount else -l.amount end), 0);

-- -----------------------------------------------------------------------------
-- Payment provider: virtual accounts, deposits, tokens, inbound events
-- -----------------------------------------------------------------------------
create table app.virtual_accounts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references app.users (id) on delete restrict,
  wallet_id           uuid not null references app.wallets (id) on delete restrict,
  provider            text not null check (provider in ('moneta')),
  provider_reference  text not null,                  -- Moneta virtual_account_reference
  account_number      text not null check (account_number ~ '^[0-9]{10}$'),
  account_name        text not null,
  bank_name           text not null,
  status              text not null default 'active' check (status in ('active', 'inactive', 'closed')),
  raw                 jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (provider, provider_reference),
  unique (account_number)
);
create unique index virtual_accounts_one_active on app.virtual_accounts (wallet_id) where status = 'active';
create trigger virtual_accounts_touch before update on app.virtual_accounts for each row execute function app.touch_updated_at();

create table app.deposits (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references app.users (id) on delete restrict,
  wallet_id            uuid not null references app.wallets (id) on delete restrict,
  virtual_account_id   uuid not null references app.virtual_accounts (id) on delete restrict,
  provider             text not null,
  provider_reference   text not null,                 -- the bank credit's reference at the provider
  amount               numeric(18,2) not null check (amount > 0),
  fee                  numeric(18,2) not null default 0 check (fee >= 0),
  sender_name          text,
  sender_bank          text,
  sender_account_last4 text,
  status               text not null default 'detected' check (status in ('detected', 'credited', 'held_for_review', 'rejected')),
  ledger_entry_id      uuid references app.wallet_ledger (id),
  raw                  jsonb,
  detected_at          timestamptz not null default now(),
  credited_at          timestamptz,
  updated_at           timestamptz not null default now(),
  unique (provider, provider_reference),
  constraint deposits_credited_consistent check ((status = 'credited') = (ledger_entry_id is not null and credited_at is not null))
);
create index deposits_user_idx on app.deposits (user_id, detected_at desc);
create index deposits_open_idx on app.deposits (status) where status in ('detected', 'held_for_review');
create trigger deposits_touch before update on app.deposits for each row execute function app.touch_updated_at();

-- Moneta keeps one live partner token; every instance shares it from here.
create table app.provider_tokens (
  provider     text primary key,
  token        text not null,
  expires_at   timestamptz,
  minted_at    timestamptz not null default now(),
  lock_until   timestamptz                                   -- set while one instance is minting
);

create table app.provider_events (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null,
  event_id     text not null,           -- provider's event id, or sha256 of the raw body when it has none
  event_type   text not null,
  reference    text,
  payload      jsonb not null,
  status       text not null default 'received' check (status in ('received', 'processing', 'processed', 'ignored', 'failed')),
  attempts     integer not null default 0 check (attempts >= 0),
  last_error   text,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_id)
);
create index provider_events_open_idx on app.provider_events (received_at) where status in ('received', 'failed');

-- -----------------------------------------------------------------------------
-- Purchases: airtime, data, cable TV, electricity (one table for all VTU)
-- -----------------------------------------------------------------------------
create table app.vtu_orders (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references app.users (id) on delete restrict,
  wallet_id           uuid not null references app.wallets (id) on delete restrict,
  reference           text not null unique,                 -- client idempotency key
  product             text not null check (product in ('airtime', 'data', 'cable', 'electricity', 'intl_airtime')),
  provider            text not null check (provider in ('peyflex', 'reloadly')),
  service             text not null,                        -- network / DisCo / cable provider id
  plan_code           text,
  plan_name           text,
  recipient           text not null,                        -- phone, meter or smartcard number
  recipient_name      text,                                 -- verified customer name (meter / smartcard)
  meter_type          text check (meter_type in ('prepaid', 'postpaid')),
  amount              numeric(18,2) not null check (amount > 0),
  fee                 numeric(18,2) not null default 0 check (fee >= 0),
  status              text not null default 'pending'
                        check (status in ('pending', 'processing', 'success', 'failed', 'refunded', 'unknown')),
  provider_reference  text,
  token               text,                                 -- electricity token, kept so customers can see it again
  units               text,
  provider_response   jsonb,
  last_error          text,
  attempts            integer not null default 0 check (attempts >= 0),
  next_check_at       timestamptz,                          -- when to re-query an 'unknown' outcome
  debit_entry_id      uuid references app.wallet_ledger (id),
  refund_entry_id     uuid references app.wallet_ledger (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  completed_at        timestamptz,
  constraint vtu_meter_type_only_for_power check ((product = 'electricity') = (meter_type is not null)),
  constraint vtu_refund_consistent check ((status = 'refunded') = (refund_entry_id is not null))
);
create index vtu_orders_user_idx on app.vtu_orders (user_id, created_at desc);
create index vtu_orders_open_idx on app.vtu_orders (next_check_at) where status in ('pending', 'processing', 'unknown');
create trigger vtu_orders_touch before update on app.vtu_orders for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Bank payouts / transfers
-- -----------------------------------------------------------------------------
create table app.beneficiaries (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references app.users (id) on delete cascade,
  bank_code        text not null,
  bank_name        text not null,
  account_number   text not null check (account_number ~ '^[0-9]{10}$'),
  account_name     text not null,
  nickname         text,
  last_used_at     timestamptz,
  created_at       timestamptz not null default now(),
  unique (user_id, bank_code, account_number)
);

create table app.payouts (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references app.users (id) on delete restrict,
  wallet_id                   uuid not null references app.wallets (id) on delete restrict,
  reference                   text not null unique,
  amount                      numeric(18,2) not null check (amount > 0),
  fee                         numeric(18,2) not null default 0 check (fee >= 0),
  beneficiary_bank_code       text not null,                -- NIBSS code
  beneficiary_bank_ref        text,                         -- provider's own bank id (Moneta bank_id)
  beneficiary_bank_name       text,
  beneficiary_account_number  text not null check (beneficiary_account_number ~ '^[0-9]{10}$'),
  beneficiary_account_name    text not null,                -- name returned by name enquiry, never user input
  narration                   text not null check (length(narration) <= 120),
  provider                    text not null check (provider in ('moneta')),
  provider_reference          text,
  status                      text not null default 'pending'
                                check (status in ('pending', 'processing', 'success', 'failed', 'reversed', 'unknown')),
  last_error                  text,
  attempts                    integer not null default 0 check (attempts >= 0),
  next_check_at               timestamptz,
  debit_entry_id              uuid references app.wallet_ledger (id),
  reversal_entry_id           uuid references app.wallet_ledger (id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  completed_at                timestamptz,
  constraint payouts_reversal_consistent check ((status = 'reversed') = (reversal_entry_id is not null))
);
create index payouts_user_idx on app.payouts (user_id, created_at desc);
create index payouts_open_idx on app.payouts (next_check_at) where status in ('pending', 'processing', 'unknown');
create trigger payouts_touch before update on app.payouts for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Support, profile changes, compliance, audit
-- -----------------------------------------------------------------------------
create table app.support_tickets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references app.users (id) on delete restrict,
  subject     text not null check (length(subject) between 3 and 120),
  status      text not null default 'open' check (status in ('open', 'awaiting_customer', 'resolved', 'closed')),
  related_type text check (related_type in ('deposit', 'vtu_order', 'payout')),
  related_id  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index support_tickets_user_idx on app.support_tickets (user_id, created_at desc);
create index support_tickets_open_idx on app.support_tickets (created_at) where status in ('open', 'awaiting_customer');
create trigger support_tickets_touch before update on app.support_tickets for each row execute function app.touch_updated_at();

create table app.support_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references app.support_tickets (id) on delete cascade,
  author_id   uuid not null references app.users (id) on delete restrict,
  body        text not null check (length(body) between 1 and 5000),
  created_at  timestamptz not null default now()
);
create index support_messages_ticket_idx on app.support_messages (ticket_id, created_at);

create table app.account_update_requests (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references app.users (id) on delete restrict,
  requested_fields  jsonb not null check (jsonb_typeof(requested_fields) = 'object'),
  status            text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by       uuid references app.users (id),
  admin_note        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index account_update_requests_open_idx on app.account_update_requests (created_at) where status = 'pending';
create trigger account_update_requests_touch before update on app.account_update_requests for each row execute function app.touch_updated_at();

create table app.compliance_flags (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references app.users (id) on delete restrict,
  subject_type  text not null check (subject_type in ('user', 'deposit', 'vtu_order', 'payout')),
  subject_id    uuid not null,
  rule_code     text not null,
  status        text not null default 'open' check (status in ('open', 'cleared', 'escalated')),
  metadata      jsonb,
  reviewed_by   uuid references app.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (subject_type, subject_id, rule_code)
);
create index compliance_flags_open_idx on app.compliance_flags (created_at) where status = 'open';
create trigger compliance_flags_touch before update on app.compliance_flags for each row execute function app.touch_updated_at();

create table app.audit_log (
  id             uuid primary key default gen_random_uuid(),
  actor_user_id  uuid references app.users (id) on delete restrict,
  actor_role     text,
  action         text not null,
  target_type    text,
  target_id      text,
  success        boolean not null default true,
  reason         text,
  before         jsonb,
  after          jsonb,
  ip             inet,
  user_agent     text,
  request_id     text,
  created_at     timestamptz not null default now()
);
create index audit_log_actor_idx on app.audit_log (actor_user_id, created_at desc);
create index audit_log_target_idx on app.audit_log (target_type, target_id, created_at desc);
create trigger audit_log_append_only before update or delete on app.audit_log for each row execute function app.forbid_change();

create table app.training_registrations (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null check (length(btrim(full_name)) >= 3),
  email       citext not null,
  phone       text not null,
  created_at  timestamptz not null default now(),
  unique (email, phone)
);

-- -----------------------------------------------------------------------------
-- Lock the schema down: RLS on (no policies = no access for API roles).
-- -----------------------------------------------------------------------------
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'app' loop
    execute format('alter table app.%I enable row level security', t.tablename);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on app.%I from anon', t.tablename);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on app.%I from authenticated', t.tablename);
    end if;
  end loop;
end $$;
