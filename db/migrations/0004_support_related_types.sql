-- Tickets can point at any payment a customer reports from its receipt: purchases
-- (vtu_order), bank payouts, Wymlink transfers, deposits and ledger lines.
alter table app.support_tickets drop constraint if exists support_tickets_related_type_check;
alter table app.support_tickets
  add constraint support_tickets_related_type_check
  check (related_type in ('deposit', 'vtu_order', 'payout', 'transfer', 'ledger'));
