import 'dotenv/config';
import pg from 'pg';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const checksumOf=sql=>createHash('sha256').update(sql.replace(/\r\n/g,'\n')).digest('hex');
const baselineFlag=process.argv.indexOf('--baseline-through');
const baseline=baselineFlag<0?null:process.argv[baselineFlag+1];
const filename=/^\d{12,}_.*\.sql$/;
const files=readdirSync(new URL('supabase/migrations/',root)).filter(v=>filename.test(v)).sort();
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL is required');
if(baseline&&!files.some(v=>v.startsWith(baseline+'_')))throw Error('Unknown baseline migration version');
const client=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL_CA_FILE?{ca:readFileSync(process.env.DATABASE_SSL_CA_FILE,'utf8'),rejectUnauthorized:true}:undefined});
// Baselines are explicit adoption of an existing schema, never silent inference.
const probes={
 '202611140001':"select to_regclass('public.organizations') is not null ok",
 '202611140002':"select to_regclass('public.whatsapp_auth') is not null ok",
 '202611140003':"select to_regclass('public.whatsapp_inbox') is not null ok",
 '202611140004':"select exists(select 1 from information_schema.columns where table_name='organizations' and column_name='reply_delay_ms') ok",
 '202611140005':"select exists(select 1 from pg_indexes where indexname='whatsapp_identity_unique' and indexdef like '%removed_at IS NULL%') ok",
 '202611140006':"select to_regprocedure('public.notify_workspace_change()') is not null ok",
 '202611140007':"select to_regclass('public.appointment_requests') is not null ok",
 '202611140008':"select to_regclass('public.whatsapp_owner_reads') is not null ok",
 '202611140009':"select to_regclass('public.status_portal_logins') is not null ok",
 '202611140010':"select exists(select 1 from information_schema.columns where table_name='whatsapp_accounts' and column_name='desired_connected') ok",
 '202611140011':"select to_regclass('public.handoff_unread_requests') is not null ok",
 '202611140013':"select exists(select 1 from information_schema.columns where table_name='messages' and column_name='ai_context_source') ok",
 '202611140012':"select exists(select 1 from information_schema.columns where table_name='calendar_oauth_flows' and column_name='disclosure_version') ok"
};
try{
 await client.connect();await client.query('select pg_advisory_lock(678123902)');
 await client.query('create schema if not exists codetic_ops');
 await client.query('revoke all on schema codetic_ops from public,anon,authenticated');
 await client.query('create table if not exists codetic_ops.migrations(filename text primary key,checksum text not null,applied_at timestamptz not null default now())');
 const tracked=new Map((await client.query('select filename,checksum from codetic_ops.migrations')).rows.map(r=>[r.filename,r.checksum]));
 if(baseline&&tracked.size)throw Error('Baseline is only allowed for an untracked existing database');
 if(!baseline&&!tracked.size&&(await client.query("select to_regclass('public.organizations') as name")).rows[0].name)throw Error('Existing untracked schema: review its actual migration level, back up, then use --baseline-through VERSION once. No application schema was changed.');
 if(baseline){
  await client.query('begin');
  for(const file of files.filter(v=>v.split('_')[0]<=baseline)){
   const version=file.split('_')[0];if(!probes[version]||!(await client.query(probes[version])).rows[0].ok)throw Error(`Baseline probe failed for ${file}; inspect the schema before proceeding`);
   const checksum=checksumOf(readFileSync(new URL('supabase/migrations/'+file,root),'utf8'));
   await client.query('insert into codetic_ops.migrations(filename,checksum) values($1,$2)',[file,checksum]);tracked.set(file,checksum);
  }
  await client.query('commit');console.log('Recorded reviewed legacy baseline:',baseline);
 }
 for(const file of files){
  const sql=readFileSync(new URL('supabase/migrations/'+file,root),'utf8');const checksum=checksumOf(sql);
  if(tracked.has(file)){if(tracked.get(file)!==checksum){const windowsChecksum=createHash('sha256').update(sql.replace(/\r?\n/g,'\r\n')).digest('hex');const rawChecksum=createHash('sha256').update(sql).digest('hex');if(tracked.get(file)!==windowsChecksum&&tracked.get(file)!==rawChecksum)throw Error(`Applied migration checksum changed: ${file}`);await client.query('update codetic_ops.migrations set checksum=$2 where filename=$1 and checksum=$3',[file,checksum,tracked.get(file)]);}continue;}
  await client.query('begin');await client.query(sql);await client.query('insert into codetic_ops.migrations(filename,checksum) values($1,$2)',[file,checksum]);await client.query('commit');console.log('Applied',file);
 }
 console.log('Database migrations are current.');
}catch(error){await client.query('rollback').catch(()=>{});console.error('Migration stopped:',error.code||error.message);process.exitCode=1;}
finally{await client.end().catch(()=>{});}
