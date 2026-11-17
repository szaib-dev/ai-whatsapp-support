-- Extend the existing transaction-aware change stream to scheduling and attention.
do $$ declare t text; begin
 foreach t in array array['calendar_connections','appointment_requests','attention_events'] loop
 execute format('create trigger workspace_notify after insert or update or delete on public.%I for each row execute function public.notify_workspace_change()',t);
 end loop;
end $$;
