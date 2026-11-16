-- Additive only. Identity aliases remain intact; UI grouping uses trusted phone mappings.
alter table conversations add column last_read_at timestamptz;
alter table appointment_requests add column contact_number text not null default '' check(length(contact_number)<=32);
update notification_preferences set include_preview=false where principal like 'portal:%';
alter table whatsapp_accounts add column last_connected_at timestamptz;
