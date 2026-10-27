-- QR payments (ported from TAPA). The payer shows a one-time code; the receiver scans it
-- and enters the amount; the money moves as a normal Wymlink transfer.
--   active → processing (scanned, transfer running) → used | failed
--   active → expired | cancelled
create table if not exists app.qr_codes (
  id                  uuid        primary key default gen_random_uuid(),
  token               text        not null unique,
  owner_user_id       uuid        not null,
  status              text        not null default 'active'
                                  check (status in ('active', 'processing', 'used', 'failed', 'expired', 'cancelled')),
  max_amount          numeric(18,2) check (max_amount is null or max_amount > 0),
  expires_at          timestamptz not null,
  session_started_at  timestamptz not null default now(),   -- when the PIN was entered
  receiver_user_id    uuid,
  amount              numeric(18,2),
  transfer_id         uuid,
  result_message      text,
  used_at             timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists qr_codes_owner_idx on app.qr_codes (owner_user_id, created_at desc);
