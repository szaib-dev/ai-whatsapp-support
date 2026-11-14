alter table messages add column ai_context_source text not null default 'unclassified' check(ai_context_source in ('user','assistant','calendar','unclassified'));
-- Customer ingress is independently authored. Legacy generated/staff text stays excluded.
update messages set ai_context_source='user' where sender='customer';
