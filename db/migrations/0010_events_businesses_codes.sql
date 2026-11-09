-- 1. Free-purchase events (promos). While an event is active, customers buy within its
--    allowances and WymNet pays the provider: nothing is taken from their wallet, and
--    collections never count these orders. At most one event is active at a time; staff
--    end it from the console (the kill switch).
create table if not exists app.promo_events (
  id                uuid          primary key default gen_random_uuid(),
  title             text          not null check (length(btrim(title)) between 1 and 120),
  message           text          not null check (length(btrim(message)) between 1 and 1000),
  -- Allowances per customer AND per recipient (phone number / smartcard) for the whole event.
  data_max          numeric(18,2) not null default 8000 check (data_max >= 0),
  airtime_max       numeric(18,2) not null default 5000 check (airtime_max >= 0),
  -- TV: only these plan codes (each provider's base plan), at most tv_per_provider each.
  tv_plans          text[]        not null default '{gotv-easy,dstv-starter36}',
  tv_per_provider   integer       not null default 1 check (tv_per_provider >= 0),
  -- Optional ceiling on what the whole event may cost WymNet (null: no ceiling).
  budget            numeric(18,2) check (budget is null or budget > 0),
  active            boolean       not null default true,
  started_by        uuid          references app.users(id),
  started_at        timestamptz   not null default now(),
  ended_by          uuid          references app.users(id),
  ended_at          timestamptz,
  created_at        timestamptz   not null default now(),
  constraint promo_events_end_consistent check (active = (ended_at is null))
);
create unique index if not exists promo_events_one_active on app.promo_events (active) where active;

alter table app.vtu_orders add column if not exists promo_event_id uuid references app.promo_events(id);
-- A failed free order closes as 'refunded' with no refund entry: nothing was taken.
alter table app.vtu_orders drop constraint if exists vtu_refund_consistent;
alter table app.vtu_orders add constraint vtu_refund_consistent
  check (promo_event_id is not null or (status = 'refunded') = (refund_entry_id is not null));
create index if not exists vtu_orders_promo_user_idx on app.vtu_orders (promo_event_id, user_id) where promo_event_id is not null;
create index if not exists vtu_orders_promo_recipient_idx on app.vtu_orders (promo_event_id, recipient) where promo_event_id is not null;

-- 2. Customer ID: a short unique code shown to the customer and used as the name of their
--    Moneta account, so every account number can be traced back to its owner.
alter table app.users add column if not exists customer_code text;
create unique index if not exists users_customer_code_key on app.users (customer_code) where customer_code is not null;
do $$
declare
  r record;
  c text;
begin
  for r in select id from app.users where customer_code is null loop
    loop
      c := 'WL' || lpad((floor(random() * 1000000))::int::text, 6, '0');
      exit when not exists (select 1 from app.users where customer_code = c);
    end loop;
    update app.users set customer_code = c where id = r.id;
  end loop;
end $$;

-- 3. WymNet's own businesses. Each has an internal account (role 'business', never signs in)
--    with its own wallet and Moneta account number, and a fixed QR code customers scan to
--    pay it. Payments are ordinary Wymlink transfers into that account.
alter table app.users drop constraint if exists users_role_check;
alter table app.users add constraint users_role_check
  check (role in ('customer', 'business', 'super_admin', 'business_admin', 'finance_admin'));

create table if not exists app.businesses (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null unique references app.users(id),
  name        text        not null check (length(btrim(name)) between 2 and 80),
  code        text        not null unique check (code ~ '^[A-Z0-9]{6}$'),
  active      boolean     not null default true,
  created_by  uuid        references app.users(id),
  created_at  timestamptz not null default now()
);
