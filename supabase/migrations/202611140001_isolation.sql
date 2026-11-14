-- Apply only to a NEW development Supabase project. Never reuse Drone Job Board.
create table organizations (id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz not null default now());
create table organization_members (organization_id uuid references organizations on delete cascade, user_id uuid not null references auth.users, role text not null check(role in ('owner','staff')), primary key(organization_id,user_id));
create function public.is_member(org uuid, owner_only boolean default false) returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.organization_members where organization_id=org and user_id=auth.uid() and (not owner_only or role='owner'));
$$;
revoke all on function public.is_member(uuid,boolean) from public;
grant execute on function public.is_member(uuid,boolean) to authenticated;
create table whatsapp_accounts (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations, session_id uuid not null unique default gen_random_uuid(), authenticated_jid text, status text not null default 'disconnected', unique(organization_id,id));
create table contacts (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations, identity text not null, ai_opt_out boolean not null default false, unique(organization_id,identity), unique(organization_id,id));
create table conversations (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations, account_id uuid not null, contact_id uuid not null, mode text not null default 'active' check(mode in ('active','human','paused')), unique(organization_id,id), unique(organization_id,account_id,contact_id), foreign key(organization_id,account_id) references whatsapp_accounts(organization_id,id), foreign key(organization_id,contact_id) references contacts(organization_id,id));
create table messages (id uuid primary key default gen_random_uuid(), organization_id uuid not null, conversation_id uuid not null, external_id text not null, sender text not null check(sender in ('customer','ai','staff')), content text not null, status text not null default 'received', created_at timestamptz not null default now(), unique(organization_id,conversation_id,external_id), unique(organization_id,id), foreign key(organization_id,conversation_id) references conversations(organization_id,id));
create table contact_memories (id uuid primary key default gen_random_uuid(), organization_id uuid not null, contact_id uuid not null, source_message_id uuid not null, content text not null, provenance text not null check(provenance in ('customer_statement','staff_verified')), created_at timestamptz not null default now(), foreign key(organization_id,contact_id) references contacts(organization_id,id), foreign key(organization_id,source_message_id) references messages(organization_id,id));
-- One revision contains the full independently reviewed knowledge/config snapshot.
create table knowledge_revisions (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations, content jsonb not null, created_by uuid not null references auth.users, created_at timestamptz not null default now(), unique(organization_id,id));
create table knowledge_documents (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations, filename text not null, content text not null check(octet_length(content)<=262144), created_by uuid not null references auth.users, created_at timestamptz not null default now(), unique(organization_id,id));
create table knowledge_publications (organization_id uuid primary key references organizations, revision_id uuid not null, published_by uuid not null references auth.users, published_at timestamptz not null default now(), foreign key(organization_id,revision_id) references knowledge_revisions(organization_id,id));
create table audit_logs (id uuid primary key default gen_random_uuid(), organization_id uuid references organizations, actor_id uuid, event text not null, resource_id uuid, created_at timestamptz not null default now());
create table processing_events (organization_id uuid not null, conversation_id uuid not null, external_id text not null, state text not null check(state in ('processing','sent','escalated','uncertain')), created_at timestamptz not null default now(), primary key(organization_id,conversation_id,external_id), foreign key(organization_id,conversation_id) references conversations(organization_id,id));
create index messages_recent on messages(organization_id,conversation_id,created_at desc);
create index memories_contact on contact_memories(organization_id,contact_id);
create index revisions_recent on knowledge_revisions(organization_id,created_at desc);
alter table organizations enable row level security;
alter table organization_members enable row level security;
create policy org_read on organizations for select to authenticated using(public.is_member(id));
create policy members_read on organization_members for select to authenticated using(public.is_member(organization_id));
do $$ declare t text; begin
 foreach t in array array['whatsapp_accounts','contacts','conversations','messages','contact_memories','knowledge_revisions','knowledge_documents','knowledge_publications','audit_logs','processing_events'] loop
 execute format('alter table %I enable row level security',t);
 execute format('create policy tenant_read on %I for select to authenticated using(public.is_member(organization_id))',t);
 end loop;
end $$;
-- Browser is read-only. All mutations go through verified API membership checks.
grant select on all tables in schema public to authenticated;
revoke insert,update,delete on all tables in schema public from authenticated,anon;
create function immutable_revision() returns trigger language plpgsql as $$ begin raise exception 'Knowledge revisions are immutable'; end $$;
create trigger revision_immutable before update or delete on knowledge_revisions for each row execute function immutable_revision();
create trigger document_immutable before update or delete on knowledge_documents for each row execute function immutable_revision();
create function immutable_account_tenant() returns trigger language plpgsql as $$ begin
 if new.organization_id <> old.organization_id or new.session_id <> old.session_id then raise exception 'Session binding is immutable'; end if; return new;
end $$;
create trigger account_binding_immutable before update on whatsapp_accounts for each row execute function immutable_account_tenant();
