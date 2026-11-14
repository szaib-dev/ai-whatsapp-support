alter table calendar_oauth_flows add column data_use_consented_at timestamptz;
alter table calendar_oauth_flows add column disclosure_version text;
