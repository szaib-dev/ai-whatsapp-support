create or replace function public.notify_workspace_change() returns trigger language plpgsql as $$
declare org uuid;
begin
 if TG_TABLE_NAME='organizations' then org=coalesce(new.id,old.id); else org=coalesce(new.organization_id,old.organization_id); end if;
 perform pg_notify('workspace_changes',org::text);
 return null;
end $$;
do $$ declare t text; begin
 foreach t in array array['organizations','whatsapp_accounts','conversations','messages','knowledge_publications','audit_logs','contact_memories'] loop
 execute format('create trigger workspace_notify after insert or update or delete on public.%I for each row execute function public.notify_workspace_change()',t);
 end loop;
end $$;
