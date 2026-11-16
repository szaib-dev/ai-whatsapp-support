-- Additive: existing WhatsApp bookings and Google credentials remain untouched.
create table workspace_features (
 organization_id uuid not null references organizations(id),
 feature_key text not null check(feature_key in ('advanced_appointments')),
 enabled boolean not null default false,
 updated_by uuid references auth.users(id), updated_at timestamptz not null default now(),
 primary key(organization_id,feature_key)
);
alter table workspace_features enable row level security;
revoke all on workspace_features from anon,authenticated;
create trigger feature_notify after insert or update or delete on workspace_features for each row execute function public.notify_workspace_change();
alter table appointment_requests alter column conversation_id drop not null;
alter table appointment_requests alter column contact_id drop not null;
alter table appointment_requests add column title text not null default 'Appointment';
alter table appointment_requests add column customer_name text not null default '';
alter table appointment_requests add column notes text not null default '';
alter table appointment_requests add column kind text not null default 'appointment' check(kind in ('appointment','blocked'));
alter table appointment_requests add column request_key uuid;
alter table appointment_requests add column sync_action text check(sync_action in ('save','cancel'));
create unique index appointment_manual_idempotency on appointment_requests(organization_id,request_key) where request_key is not null;
