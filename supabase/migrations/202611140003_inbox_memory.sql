alter table contacts add column display_name text;
alter table contact_memories add column kind text not null default 'note';
alter table contact_memories add column expires_at timestamptz not null default (now()+interval '30 days');
create unique index memory_profile_key on contact_memories(organization_id,contact_id,kind) where kind='preferred_name';
create table whatsapp_inbox (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 account_id uuid not null, session_id uuid not null, customer_jid text not null,
 external_id text not null, content text not null check(length(content)<=8000),
 received_at timestamptz not null default now(),
 state text not null default 'pending' check(state in ('pending','processing','done','uncertain','failed')),
 unique(organization_id,account_id,external_id),
 foreign key(organization_id,account_id) references whatsapp_accounts(organization_id,id)
);
alter table whatsapp_inbox enable row level security;
revoke all on whatsapp_inbox from anon,authenticated;
create index inbox_ready on whatsapp_inbox(state,received_at);
create index inbox_customer on whatsapp_inbox(organization_id,account_id,customer_jid,state);
create index memory_expiry on contact_memories(organization_id,contact_id,expires_at);
