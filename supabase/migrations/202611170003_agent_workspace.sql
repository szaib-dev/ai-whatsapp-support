-- Per-workspace editable Markdown, immutable history and bounded context settings.
create table agent_settings (
 organization_id uuid primary key references organizations(id),
 context_tokens integer not null default 6000 check(context_tokens between 4096 and 16000),
 history_messages integer not null default 24 check(history_messages between 4 and 60),
 response_tokens integer not null default 450 check(response_tokens between 100 and 1200),
 revision integer not null default 1, updated_at timestamptz not null default now()
);
create table agent_documents (
 organization_id uuid not null references organizations(id),
 name text not null check(name in ('IDENTITY.md','SOUL.md','OWNER.md','RULES.md','KNOWLEDGE.md','MEMORY.md')),
 content text not null check(length(content)<=320000), enabled boolean not null default true,
 max_tokens integer not null default 1200 check(max_tokens between 64 and 3000),
 version integer not null default 1, updated_at timestamptz not null default now(),
 primary key(organization_id,name)
);
create table agent_document_versions (
 organization_id uuid not null, name text not null, version integer not null,
 content text not null, enabled boolean not null, max_tokens integer not null,
 created_at timestamptz not null default now(), created_by uuid references auth.users,
 primary key(organization_id,name,version), foreign key(organization_id,name) references agent_documents(organization_id,name)
);
create trigger agent_version_immutable before update or delete on agent_document_versions for each row execute function immutable_revision();
-- Keep all prior knowledge revisions/documents intact. Copy the published revision once.
insert into agent_settings(organization_id) select id from organizations;
with legacy as (
 select o.id,o.name,coalesce(r.content,'{}'::jsonb) as k from organizations o
 left join knowledge_publications p on p.organization_id=o.id
 left join knowledge_revisions r on r.organization_id=p.organization_id and r.id=p.revision_id
)
insert into agent_documents(organization_id,name,content)
select id,d.name,d.content from legacy cross join lateral (values
 ('IDENTITY.md','# Identity

You are the assistant for '||coalesce(nullif(k->>'businessName',''),name)||'. Help with approved information and involve the owner when needed. Introduce yourself as an assistant, and be honest about being AI when directly asked.'),
 ('SOUL.md',coalesce(nullif(k->>'instructions',''),'# Personality

Be warm, concise and natural. Match the sender’s current language and texting style. Avoid repeated introductions and unnecessary questions.')||'

Configured tone: '||coalesce(k->>'tone','warm')||'.'),
 ('OWNER.md','# Approved owner information

No owner biography or personal preferences have been provided. Do not invent them.'),
 ('RULES.md','# Conversation rules

'||coalesce(k->>'escalationRules','')||'

'||coalesce(k->>'neverClaims','')||'

Use silence when no response is useful. A handover acknowledgement should fit the conversation and personality, without promises about response time.'),
 ('KNOWLEDGE.md','# Business information

'||coalesce(k->>'description','')||'

## Approved answers

'||coalesce((select string_agg('### '||(f->>'question')||'
'||(f->>'answer'),'

') from jsonb_array_elements(coalesce(k->'facts','[]'::jsonb)) f),'')),
 ('MEMORY.md','# Approved global memory

No long-term workspace preferences have been approved. Customer-specific memories remain separate.')
) d(name,content);
insert into agent_document_versions(organization_id,name,version,content,enabled,max_tokens) select organization_id,name,version,content,enabled,max_tokens from agent_documents;
do $$ declare t text; begin
 foreach t in array array['agent_settings','agent_documents','agent_document_versions'] loop
 execute format('alter table %I enable row level security',t);
 -- Client portal credentials have no PostgREST access. Only workspace members may read.
 execute format('create policy agent_tenant_read on %I for select to authenticated using(public.is_member(organization_id))',t);
 execute format('grant select on %I to authenticated',t);
 execute format('revoke insert,update,delete on %I from authenticated,anon',t);
 end loop;
end $$;
