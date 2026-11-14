create table status_portal_logins (
 organization_id uuid primary key references organizations(id),
 email text not null unique check(email=lower(trim(email))),
 password_hash text not null,
 credential_version uuid not null default gen_random_uuid(),
 enabled boolean not null default true,
 failed_attempts integer not null default 0,
 locked_until timestamptz,
 updated_at timestamptz not null default now()
);
create table status_portal_sessions (
 token_hash text primary key, organization_id uuid not null references status_portal_logins(organization_id) on delete cascade,
 expires_at timestamptz not null,created_at timestamptz not null default now()
);
alter table status_portal_logins enable row level security;
alter table status_portal_sessions enable row level security;
revoke all on status_portal_logins,status_portal_sessions from anon,authenticated;
