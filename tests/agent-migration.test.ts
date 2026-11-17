import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
it('backfills a large published configuration intact without deleting legacy revisions or mixing owners',async()=>{
 const db=new PGlite(),org=randomUUID(),other=randomUUID(),revision=randomUUID();
 try{
  await db.exec("create role authenticated;create role anon;create schema auth;create table auth.users(id uuid primary key);create table organizations(id uuid primary key,name text);create table knowledge_revisions(organization_id uuid,id uuid,content jsonb);create table knowledge_publications(organization_id uuid,revision_id uuid);create function public.is_member(uuid) returns boolean language sql as $$select true$$;create function immutable_revision() returns trigger language plpgsql as $$begin raise exception 'Immutable';end$$;");
  await db.query('insert into organizations values($1,$2),($3,$4)',[org,'First workspace',other,'Second workspace']);
  const facts=Array.from({length:100},(_,i)=>({question:'Question '+i,answer:'Confirmed fact '+i+' '+ 'a'.repeat(2490)}));
  await db.query('insert into knowledge_revisions values($1,$2,$3)',[org,revision,JSON.stringify({businessName:'Independent studio',instructions:'Personal style preserved',tone:'professional',description:'Approved description',escalationRules:'Speak to owner',neverClaims:'No invented prices',facts})]);await db.query('insert into knowledge_publications values($1,$2)',[org,revision]);
  await db.exec(readFileSync('supabase/migrations/202611170003_agent_workspace.sql','utf8'));
  const docs=(await db.query<any>('select * from agent_documents where organization_id=$1',[org])).rows;expect(docs).toHaveLength(6);
  expect(docs.find(d=>d.name==='SOUL.md').content).toContain('Personal style preserved');expect(docs.find(d=>d.name==='SOUL.md').content).toContain('professional');
  const knowledge=docs.find(d=>d.name==='KNOWLEDGE.md').content;expect(knowledge.length).toBeGreaterThan(24000);expect(knowledge).toContain(facts[99].answer);
  expect((await db.query('select * from knowledge_revisions')).rows).toHaveLength(1);
  expect(JSON.stringify((await db.query('select content from agent_documents where organization_id=$1',[other])).rows)).not.toContain('Personal style preserved');
  await expect(db.query("update agent_document_versions set content='overwrite' where organization_id=$1",[org])).rejects.toThrow('Immutable');
 }finally{await db.close()}
},30000);
