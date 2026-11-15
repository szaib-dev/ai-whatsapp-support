-- Additive privacy controls, scoped to the clinic rather than one WhatsApp account.
create table chat_stopped_numbers (
 organization_id uuid not null references organizations(id),
 phone text not null check(phone ~ '^[1-9][0-9]{6,14}$'),
 stopped boolean not null default true,
 stopped_at timestamptz not null default now(),
 primary key(organization_id,phone)
);
create table chat_phone_addresses (
 organization_id uuid not null, account_id uuid not null, jid text not null,
 phone text not null check(phone ~ '^[1-9][0-9]{6,14}$'),
 primary key(organization_id,account_id,jid),
 foreign key(organization_id,account_id) references whatsapp_accounts(organization_id,id)
);
create index chat_phone_lookup on chat_phone_addresses(organization_id,phone);
alter table chat_stopped_numbers enable row level security;
alter table chat_phone_addresses enable row level security;
revoke all on chat_stopped_numbers,chat_phone_addresses from public,anon,authenticated;
create function chat_phone(jid text) returns text language sql immutable as $$
 select substring(jid from '^([1-9][0-9]{6,14})(:[0-9]+)?@s[.]whatsapp[.]net$')
$$;
create function chat_is_stopped(org uuid, account uuid, address text, message_at timestamptz default null) returns boolean language sql stable as $$
 with identity as (select coalesce(chat_phone(address),(select phone from chat_phone_addresses where organization_id=org and account_id=account and jid=address)) phone)
 select exists(select 1 from chat_stopped_numbers s,identity i where s.organization_id=org and (s.stopped or (message_at is not null and s.stopped_at>=message_at)) and (i.phone is null or s.phone=i.phone))
$$;
revoke all on function chat_phone(text),chat_is_stopped(uuid,uuid,text,timestamptz) from public,anon,authenticated;

-- Backstop legacy workers/app rollback: a stopped message cannot enter the durable
-- inbox, and a CTE writing messages+inbox rolls back atomically on rejection.
create function reject_stopped_inbox() returns trigger language plpgsql as $$
begin
 if chat_is_stopped(new.organization_id,new.account_id,new.customer_jid,new.message_at) then
  raise exception 'Chat excluded by privacy settings' using errcode='42501';
 end if;
 return new;
end $$;
create trigger inbox_chat_privacy before insert on whatsapp_inbox for each row execute function reject_stopped_inbox();
create function reject_stopped_message() returns trigger language plpgsql as $$
begin
 if exists(select 1 from conversations c join contacts t on t.organization_id=c.organization_id and t.id=c.contact_id
  where c.organization_id=new.organization_id and c.id=new.conversation_id and chat_is_stopped(c.organization_id,c.account_id,t.identity)) then
  raise exception 'Chat excluded by privacy settings' using errcode='42501';
 end if;
 return new;
end $$;
create trigger message_chat_privacy before insert on messages for each row execute function reject_stopped_message();
revoke all on function reject_stopped_inbox(),reject_stopped_message() from public,anon,authenticated;
