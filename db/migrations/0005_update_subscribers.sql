-- People who asked for Wymlink news through the website's "Stay updated" form.
create table if not exists app.update_subscribers (
  id          uuid primary key default gen_random_uuid(),
  email       citext not null unique,
  source      text not null default 'website' check (length(source) <= 40),
  created_at  timestamptz not null default now()
);
