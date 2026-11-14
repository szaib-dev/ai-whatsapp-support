-- Retry marking staff handoffs unread without ever resending the handoff notice.
create table public.handoff_unread_requests (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 conversation_id uuid primary key,
 account_id uuid not null,
 customer_jid text not null,
 message_id text not null,
 message_at timestamptz not null,
 created_at timestamptz not null default now(),
 foreign key (organization_id,conversation_id) references public.conversations(organization_id,id) on delete cascade,
 foreign key (organization_id,account_id) references public.whatsapp_accounts(organization_id,id) on delete cascade
);
alter table public.handoff_unread_requests enable row level security;
revoke all on public.handoff_unread_requests from anon,authenticated;
