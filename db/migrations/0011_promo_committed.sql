-- What each free event has given out so far (delivered + possibly delivered), kept as a
-- counter so the budget and the kill switch are checked with one short row update per free
-- purchase, instead of holding the event row while the allowances are summed.
alter table app.promo_events add column if not exists committed numeric(18,2) not null default 0 check (committed >= 0);

update app.promo_events e
   set committed = coalesce((
     select sum(o.amount) from app.vtu_orders o
      where o.promo_event_id = e.id and o.status in ('processing', 'pending', 'success', 'unknown')), 0);
