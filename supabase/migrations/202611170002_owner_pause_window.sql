-- Timed owner takeovers survive restarts. Explicit manual/AI handovers remain indefinite.
alter table conversations add column owner_pause_until timestamptz;
create index conversations_owner_pause_due on conversations(organization_id,account_id,owner_pause_until) where owner_pause_until is not null;
