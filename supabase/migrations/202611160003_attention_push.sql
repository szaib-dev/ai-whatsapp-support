-- Additive conversation intelligence and private, durable Web Push outbox.
alter table contacts add column assistant_behavior text not null default 'normal' check(assistant_behavior in ('normal','ignore','notify','human'));
alter table contacts add column assistant_instructions text not null default '' check(length(assistant_instructions)<=2000);
alter table conversations add column assistant_version integer not null default 0;
alter table conversations add column handoff_reason text;
alter table conversations add column assistant_resumed_at timestamptz;
alter table conversations add column last_owner_message_at timestamptz;

-- Invalidate work even if an owner pauses and resumes while the model is running.
create function conversation_version() returns trigger language plpgsql as $$ begin
 if new.mode is distinct from old.mode then new.assistant_version=old.assistant_version+1; if new.mode='active' then new.assistant_resumed_at=now(); end if; end if;
 return new; end $$;
create trigger conversation_version before update on conversations for each row execute function conversation_version();

create table outbound_message_ids (
 organization_id uuid not null,account_id uuid not null,external_id text not null,customer_jid text not null,
 created_at timestamptz not null default now(),primary key(organization_id,account_id,external_id),
 foreign key(organization_id,account_id) references whatsapp_accounts(organization_id,id)
);
create table owner_message_events (
 organization_id uuid not null,account_id uuid not null,external_id text not null,customer_jid text not null,
 message_at timestamptz not null,primary key(organization_id,account_id,external_id),
 foreign key(organization_id,account_id) references whatsapp_accounts(organization_id,id)
);
create table attention_events (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations,
 conversation_id uuid,category text not null check(category in ('urgent','owner','handover','appointment','test')),
 reason text not null check(length(reason)<=240),preview text not null default '' check(length(preview)<=240),
 sender_name text not null default '' check(length(sender_name)<=120),dedup_key text not null,
 created_at timestamptz not null default now(),resolved_at timestamptz,
 unique(organization_id,id),unique(organization_id,dedup_key),
 foreign key(organization_id,conversation_id) references conversations(organization_id,id) on delete cascade
);
create index attention_recent on attention_events(organization_id,created_at desc);
create table notification_preferences (
 organization_id uuid not null references organizations,principal text not null,
 enabled boolean not null default true,include_preview boolean not null default false,
 categories text[] not null default array['urgent','owner','handover','appointment'],
 primary key(organization_id,principal)
);
create table push_subscriptions (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations,
 principal text not null,endpoint text not null unique,keys jsonb not null,
 created_at timestamptz not null default now(),unique(organization_id,id)
);
create table push_deliveries (
 organization_id uuid not null,event_id uuid not null,subscription_id uuid not null,
 state text not null default 'pending' check(state in ('pending','sent','failed','skipped')),
 attempts integer not null default 0,next_attempt_at timestamptz not null default now(),last_error text,
 primary key(event_id,subscription_id),
 foreign key(organization_id,event_id) references attention_events(organization_id,id) on delete cascade,
 foreign key(organization_id,subscription_id) references push_subscriptions(organization_id,id) on delete cascade
);
create function queue_attention(org uuid,conv uuid,category text,reason text,preview text,sender_name text,dedup_key text) returns void language sql as $$
 insert into attention_events(organization_id,conversation_id,category,reason,preview,sender_name,dedup_key)
 values(org,conv,category,left(reason,240),left(preview,240),left(sender_name,120),dedup_key)
 on conflict(organization_id,dedup_key) do nothing;
$$;
create function queue_push_deliveries() returns trigger language plpgsql as $$ begin
 insert into push_deliveries(organization_id,event_id,subscription_id)
 select new.organization_id,new.id,s.id from push_subscriptions s
 left join notification_preferences p on p.organization_id=s.organization_id and p.principal=s.principal
 where s.organization_id=new.organization_id and coalesce(p.enabled,true)
 and (new.category='test' or new.category=any(coalesce(p.categories,array['urgent','owner','handover','appointment'])));
 return new; end $$;
create trigger attention_push after insert on attention_events for each row execute function queue_push_deliveries();
create trigger attention_notify after insert or update on attention_events for each row execute function public.notify_workspace_change();

-- Calendar metadata stays in our database, never in the external model prompt.
create function appointment_attention() returns trigger language plpgsql as $$ begin
 if new.status in ('booked','cancelled','uncertain','conflict') and new.status is distinct from old.status then
  perform queue_attention(new.organization_id,new.conversation_id,'appointment',
   case new.status when 'booked' then 'Appointment confirmed' when 'cancelled' then 'Appointment cancelled' else 'Appointment needs attention' end,
   '',coalesce(new.customer_name,''),'appointment:'||new.id::text||':'||new.status||':'||extract(epoch from clock_timestamp())::text);
 end if; return new; end $$;
create trigger appointment_attention after update on appointment_requests for each row execute function appointment_attention();
do $$ declare t text; begin
 foreach t in array array['outbound_message_ids','owner_message_events','attention_events','notification_preferences','push_subscriptions','push_deliveries'] loop
  execute format('alter table %I enable row level security',t);
  execute format('revoke all on %I from anon,authenticated',t);
 end loop; end $$;
revoke all on function queue_attention(uuid,uuid,text,text,text,text,text) from public,anon,authenticated;
revoke all on function queue_push_deliveries() from public,anon,authenticated;
revoke all on function appointment_attention() from public,anon,authenticated;
