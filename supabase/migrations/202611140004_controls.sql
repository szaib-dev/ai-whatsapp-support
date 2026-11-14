alter table organizations add column reply_delay_ms integer not null default 1000 check(reply_delay_ms between 0 and 30000);
alter table organizations add column reply_max_wait_ms integer not null default 10000 check(reply_max_wait_ms between 1000 and 60000);
alter table whatsapp_accounts add column removed_at timestamptz;
alter table whatsapp_inbox add column attempts integer not null default 0;
alter table whatsapp_inbox add column last_error text;
