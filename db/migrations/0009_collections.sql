-- =============================================================================
-- Collections: moving the money customers spent out of their Moneta accounts.
--
-- Purchases (airtime, data, cable, electricity) are paid from WymNet's provider
-- balance (Peyflex/Reloadly) and deducted from the customer's Wymlink wallet, but
-- the customer's money stays in their Moneta virtual account. A collection pays
-- that money from the customer's VA to WymNet's bank account.
--
-- What a customer owes = delivered provider purchases − what was already collected.
-- Collections never touch the wallet ledger: the wallet was debited at purchase.
-- Moneta charges its payout fee on top, from the VA; WymNet absorbs it, so the
-- amount sent is (collected − fee) and the VA ends equal to the wallet balance.
-- =============================================================================

-- The bank account collections are paid to (one active setting; history kept).
create table app.collection_accounts (
  id              uuid primary key default gen_random_uuid(),
  bank_code       text not null,                 -- Moneta bank_id
  bank_name       text not null,
  account_number  text not null check (account_number ~ '^[0-9]{10}$'),
  account_name    text not null,                 -- from name enquiry, never typed in
  active          boolean not null default true,
  set_by          uuid references app.users (id) on delete restrict,
  created_at      timestamptz not null default now()
);
create unique index collection_accounts_one_active on app.collection_accounts (active) where active;

-- One payout from one customer's VA to the collection account.
create table app.collections (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references app.users (id) on delete restrict,
  virtual_account_id     uuid not null references app.virtual_accounts (id) on delete restrict,
  collection_account_id  uuid not null references app.collection_accounts (id) on delete restrict,
  owed_before            numeric(18,2) not null check (owed_before >= 0),   -- owed when it started
  va_balance_before      numeric(18,2),                                     -- Moneta balance read just before
  gross                  numeric(18,2) not null check (gross > 0),          -- leaves the VA (sent + fee)
  fee                    numeric(18,2) not null check (fee >= 0),           -- Moneta's charge (absorbed by WymNet)
  sent                   numeric(18,2) not null check (sent > 0),           -- arrives in WymNet's bank
  narration              text not null check (length(narration) <= 120),    -- starts with a WYMCOL tag
  status                 text not null default 'processing'
                           check (status in ('processing', 'success', 'failed', 'unknown')),
  provider_reference     text,
  last_error             text,
  created_by             uuid references app.users (id) on delete restrict,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  completed_at           timestamptz,
  constraint collections_math check (gross = sent + fee)
);
create index collections_user_idx on app.collections (user_id, created_at desc);
create index collections_open_idx on app.collections (created_at) where status in ('processing', 'unknown');
-- Never two collections running for one customer at once.
create unique index collections_one_open_per_user on app.collections (user_id) where status in ('processing', 'unknown');
create trigger collections_touch before update on app.collections for each row execute function app.touch_updated_at();

alter table app.collection_accounts enable row level security;
alter table app.collections enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on app.collection_accounts, app.collections from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on app.collection_accounts, app.collections from authenticated';
  end if;
end $$;
