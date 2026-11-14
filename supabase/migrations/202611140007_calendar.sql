create table calendar_connections (
 organization_id uuid primary key references organizations(id),
 email text not null, google_subject text not null, calendar_id text not null,
 calendar_name text not null, timezone text not null,
 token_ciphertext text not null, scopes text not null,
 status text not null default 'connected' check(status in ('connected','reauthorize')),
 booking_enabled boolean not null default false,
 weekdays integer[] not null default '{1,2,3,4,5}',
 opens text not null default '09:00', closes text not null default '17:00',
 duration_minutes integer not null default 30 check(duration_minutes between 10 and 240),
 connected_at timestamptz not null default now()
);
create table calendar_invites (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations,
 token_hash text not null unique, expires_at timestamptz not null,
 consumed_at timestamptz, revoked_at timestamptz,created_by uuid not null references auth.users,
 created_at timestamptz not null default now()
);
create table calendar_oauth_flows (
 id uuid primary key, invite_id uuid not null references calendar_invites,
 state_hash text not null unique,browser_hash text not null,verifier_ciphertext text not null,
 expires_at timestamptz not null,used_at timestamptz
);
create table appointment_requests (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 conversation_id uuid not null,contact_id uuid not null,
 source_event text not null,starts_at timestamptz not null, ends_at timestamptz not null,
 timezone text not null,calendar_id text not null,
 status text not null default 'proposed' check(status in ('proposed','creating','booked','conflict','uncertain','cancelled','expired')),
 google_event_id text, google_event_url text,
 expires_at timestamptz not null default now()+interval '30 minutes',created_at timestamptz not null default now(),
 unique(organization_id,conversation_id,source_event),
 foreign key(organization_id,conversation_id) references conversations(organization_id,id),
 foreign key(organization_id,contact_id) references contacts(organization_id,id),
 check(ends_at>starts_at)
);
create index appointment_overlap on appointment_requests(organization_id,starts_at,ends_at) where status in ('creating','booked','uncertain');
alter table calendar_connections enable row level security;
alter table calendar_invites enable row level security;
alter table calendar_oauth_flows enable row level security;
alter table appointment_requests enable row level security;
revoke all on calendar_connections,calendar_invites,calendar_oauth_flows,appointment_requests from anon,authenticated;
create trigger calendar_connection_notify after insert or update or delete on calendar_connections for each row execute function public.notify_workspace_change();
create trigger appointment_notify after insert or update or delete on appointment_requests for each row execute function public.notify_workspace_change();
