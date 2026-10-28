-- Several staff answer support: a ticket can be taken by one of them, so two people
-- don't answer the same customer.
alter table app.support_tickets add column assigned_to uuid references app.users (id) on delete set null;
alter table app.support_tickets add column assigned_at timestamptz;
create index support_tickets_assigned_idx on app.support_tickets (assigned_to, updated_at desc);
