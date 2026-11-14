-- Credentials are server-only, even for clinic owners.
create table whatsapp_auth (
 organization_id uuid not null,
 account_id uuid not null,
 key_id text not null,
 ciphertext text not null,
 primary key (organization_id, account_id, key_id),
 foreign key (organization_id, account_id) references whatsapp_accounts(organization_id,id) on delete cascade
);
alter table whatsapp_auth enable row level security;
revoke all on whatsapp_auth from anon, authenticated;
create unique index whatsapp_identity_unique on whatsapp_accounts(authenticated_jid) where authenticated_jid is not null;
