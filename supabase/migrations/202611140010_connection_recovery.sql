alter table whatsapp_accounts add column desired_connected boolean not null default false;
alter table whatsapp_accounts add column reconnect_after timestamptz;
alter table whatsapp_accounts add column last_connection_error text;
alter table whatsapp_accounts add column needs_pairing boolean not null default false;
update whatsapp_accounts set desired_connected=true where removed_at is null and status in ('connected','connecting','reconnecting');
