-- Sign-in hardening: per-account sign-in lockouts, longer PIN lockouts on repeat,
-- staff two-step sign-in (authenticator app) and forced replacement of staff
-- passwords chosen by someone else.

-- Failed sign-ins per account tried. The key is a hash of the scope and the email or
-- phone typed, so unknown accounts lock exactly like real ones (no account discovery)
-- and the table holds no contact details.
create table app.login_attempts (
  key              text primary key,
  failed_attempts  integer not null default 0 check (failed_attempts >= 0),
  lockouts         integer not null default 0 check (lockouts >= 0),   -- in a row; each doubles the next lock
  locked_until     timestamptz,
  last_failed_at   timestamptz,
  updated_at       timestamptz not null default now()
);
create trigger login_attempts_touch before update on app.login_attempts for each row execute function app.touch_updated_at();

-- Repeated PIN/passcode lockouts grow longer instead of resetting every few minutes.
alter table app.pin_attempts add column lockouts integer not null default 0 check (lockouts >= 0);

-- Staff authenticator (TOTP). The secret is sealed (AES-256-GCM) by the backend.
create table app.admin_mfa (
  user_id        uuid primary key references app.users (id) on delete cascade,
  secret_sealed  text not null,
  enrolled_at    timestamptz not null default now(),
  last_step      bigint,         -- last accepted 30-second step: each code works once
  updated_at     timestamptz not null default now()
);
create trigger admin_mfa_touch before update on app.admin_mfa for each row execute function app.touch_updated_at();

-- A staff password that was right, waiting for the authenticator code (single use, 5 minutes).
-- Staff without an authenticator get a new secret with each challenge; the first right code
-- for it enrols it.
create table app.admin_mfa_challenges (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references app.users (id) on delete cascade,
  token_hash     text not null,
  lock_keys      text not null,  -- the login_attempts keys wrong codes count against (space-separated)
  enroll_sealed  text,
  attempts       integer not null default 0 check (attempts >= 0),
  expires_at     timestamptz not null,
  used_at        timestamptz,
  created_at     timestamptz not null default now()
);
create index admin_mfa_challenges_user_idx on app.admin_mfa_challenges (user_id, created_at desc);

-- Staff accounts created with a password someone else chose must replace it before anything else.
alter table app.users add column must_change_password boolean not null default false;
