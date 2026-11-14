alter table organizations add column reply_only_when_away boolean not null default false;
alter table whatsapp_accounts add column owner_availability text not null default 'unknown' check(owner_availability in ('unknown','online','away'));
alter table whatsapp_accounts add column owner_status_at timestamptz;
alter table whatsapp_inbox add column message_at timestamptz not null default now();
alter table whatsapp_inbox add column owner_handled_at timestamptz;
create table whatsapp_owner_activity (
 organization_id uuid not null,account_id uuid not null,customer_jid text not null,
 handled_through timestamptz not null,
 primary key(organization_id,account_id,customer_jid),
 foreign key(organization_id,account_id) references whatsapp_accounts(organization_id,id)
);
create table whatsapp_owner_reads (
 organization_id uuid not null,account_id uuid not null,external_id text not null,
 primary key(organization_id,account_id,external_id),
 foreign key(organization_id,account_id) references whatsapp_accounts(organization_id,id)
);
alter table whatsapp_owner_activity enable row level security;
alter table whatsapp_owner_reads enable row level security;
revoke all on whatsapp_owner_activity,whatsapp_owner_reads from anon,authenticated;
