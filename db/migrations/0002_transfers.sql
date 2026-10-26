-- =============================================================================
-- Wymlink → Wymlink transfers (Moneta VA → VA).
-- The sender is debited when the transfer is created; the recipient is credited
-- only after Moneta confirms. A rejected transfer is reversed to the sender; an
-- unconfirmed one is held for staff, like purchases and payouts.
-- =============================================================================

create table app.transfers (
  id                    uuid primary key default gen_random_uuid(),
  reference             text not null,                         -- client idempotency key (per sender)
  sender_user_id        uuid not null references app.users (id) on delete restrict,
  sender_wallet_id      uuid not null references app.wallets (id) on delete restrict,
  recipient_user_id     uuid not null references app.users (id) on delete restrict,
  recipient_wallet_id   uuid not null references app.wallets (id) on delete restrict,
  amount                numeric(18,2) not null check (amount > 0),
  narration             text check (length(narration) <= 120),
  provider              text not null default 'moneta' check (provider in ('moneta')),
  provider_reference    text,
  status                text not null default 'processing'
                          check (status in ('processing', 'success', 'reversed', 'unknown')),
  last_error            text,
  debit_entry_id        uuid references app.wallet_ledger (id),
  credit_entry_id       uuid references app.wallet_ledger (id),
  reversal_entry_id     uuid references app.wallet_ledger (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  completed_at          timestamptz,
  unique (sender_user_id, reference),
  constraint transfers_not_self check (sender_user_id <> recipient_user_id),
  constraint transfers_success_consistent check ((status = 'success') = (credit_entry_id is not null)),
  constraint transfers_reversed_consistent check ((status = 'reversed') = (reversal_entry_id is not null))
);
create index transfers_sender_idx on app.transfers (sender_user_id, created_at desc);
create index transfers_recipient_idx on app.transfers (recipient_user_id, created_at desc);
create index transfers_open_idx on app.transfers (created_at) where status in ('processing', 'unknown');
create trigger transfers_touch before update on app.transfers for each row execute function app.touch_updated_at();

alter table app.transfers enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on app.transfers from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on app.transfers from authenticated';
  end if;
end $$;
