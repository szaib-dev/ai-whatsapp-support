drop index whatsapp_identity_unique;
create unique index whatsapp_identity_unique on whatsapp_accounts(authenticated_jid) where authenticated_jid is not null and removed_at is null;
