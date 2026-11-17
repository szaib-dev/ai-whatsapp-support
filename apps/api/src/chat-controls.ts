import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {pool,Forbidden} from './db.js';
import {phoneNumber,privacyGate} from './chat-privacy.js';
import {contactPhoneSQL,equivalentConversations} from './contact-identity.js';
import {setConversationMode} from './attention-routes.js';
type Session={organization_id:string;tokenHash:string};
export function registerChatControls(app:FastifyInstance,sessionFor:(req:any)=>Promise<Session>,csrf:(req:any)=>void){
 app.get('/status-api/chat-assistant',async req=>{
  const session=await sessionFor(req);
  const {search='',offset,filter}=z.object({search:z.string().trim().max(100).optional(),offset:z.coerce.number().int().min(0).max(100000).default(0),filter:z.enum(['all','attention','human','timed','stopped']).default('all')}).strict().parse(req.query);
  // Only control metadata leaves this endpoint: never messages, previews,
  // instructions, handoff reasons, raw LIDs or internal account IDs.
  const rows=(await pool.query(`with mapped as (
   select c.id,c.account_id,c.mode,c.owner_pause_until,coalesce(p.display_name,(select max(np.display_name) from contacts np where np.organization_id=p.organization_id and chat_phone(np.identity)=${contactPhoneSQL()})) as display_name,p.ai_opt_out,p.assistant_behavior,chat_phone(w.authenticated_jid) as account_number,
    ${contactPhoneSQL()} as phone,chat_is_stopped(c.organization_id,c.account_id,p.identity) as privacy_stopped
   from conversations c join contacts p on p.organization_id=c.organization_id and p.id=c.contact_id
   join whatsapp_accounts w on w.organization_id=c.organization_id and w.id=c.account_id
   where c.organization_id=$1 and w.removed_at is null
  ), grouped as (
   select (array_agg(id order by id))[1] as id,max(display_name) as name,max(phone) as phone,max(account_number) as account_number,
    bool_or(privacy_stopped) as privacy_stopped,
    bool_or(ai_opt_out or assistant_behavior in ('ignore','human')) as contact_restricted,
    case when bool_or(privacy_stopped or ai_opt_out or assistant_behavior='ignore' or mode='paused') then 'stopped'
     when bool_or(assistant_behavior='human' or (mode='human' and owner_pause_until is null)) then 'human'
     when bool_or(mode='human' and owner_pause_until>now()) then 'timed' else 'active' end as state,
    max(owner_pause_until) filter(where mode='human' and owner_pause_until>now()) as pause_until
   from mapped group by account_id,coalesce(phone,id::text)
  ), combined as (
   select id,name,phone,account_number,privacy_stopped,contact_restricted,state,pause_until from grouped
   union all select null::uuid,
    (select max(p.display_name) from contacts p where p.organization_id=s.organization_id and (chat_phone(p.identity)=s.phone or exists(select 1 from chat_phone_addresses a where a.organization_id=s.organization_id and a.jid=p.identity and a.phone=s.phone))),
    s.phone,null::text,true,false,'stopped',null::timestamptz from chat_stopped_numbers s
    where s.organization_id=$1 and s.stopped and not exists(select 1 from grouped g where g.phone=s.phone)
  ) select * from combined where ($2='' or coalesce(name,'') ilike $2 or coalesce(phone,'') like $2)
   and ($4='all' or state=$4 or ($4='attention' and state<>'active')) order by (state='active'),coalesce(name,phone,''),id nulls last limit 31 offset $3`,[session.organization_id,search?'%'+search.replace(/[\\%_]/g,'\\$&')+'%':'',offset,filter])).rows;
  return {chats:rows.slice(0,30),hasMore:rows.length>30};
 });
 app.post('/status-api/chat-assistant/:id/resume',async req=>{
  csrf(req);const session=await sessionFor(req),id=z.string().uuid().parse((req.params as any).id);
  const input=z.object({unstop:z.literal(true).optional()}).strict().parse(req.body||{});
  return privacyGate(session.organization_id,true,async()=>{
   const db=await pool.connect();try{
    await db.query('begin');
    const valid=(await db.query('select 1 from status_portal_sessions s join status_portal_logins l on l.organization_id=s.organization_id where s.organization_id=$1 and s.token_hash=$2 and s.expires_at>now() and l.enabled for share of s,l',[session.organization_id,session.tokenHash])).rows[0];
    if(!valid)throw new Forbidden();
    const c=(await db.query(`select c.account_id,c.contact_id,${contactPhoneSQL()} as phone from conversations c join contacts p on p.organization_id=c.organization_id and p.id=c.contact_id where c.organization_id=$1 and c.id=$2`,[session.organization_id,id])).rows[0];
    if(!c)throw new Forbidden();
    await db.query('select id from whatsapp_accounts where organization_id=$1 and id=$2 for no key update',[session.organization_id,c.account_id]);
    const stopped=(await db.query('select 1 from conversations c join contacts p on p.organization_id=c.organization_id and p.id=c.contact_id where c.organization_id=$1 and c.id=$2 and chat_is_stopped(c.organization_id,c.account_id,p.identity)',[session.organization_id,id])).rows.length>0;
    if(stopped&&input.unstop&&c.phone)await db.query('update chat_stopped_numbers set stopped=false where organization_id=$1 and phone=$2',[session.organization_id,c.phone]);
    else if(stopped)throw new z.ZodError([{code:'custom',path:[],message:'A verified contact number is required to unstop this chat.'}]);
    const ids=await equivalentConversations(db,session.organization_id,id);
    await db.query("update contacts set ai_opt_out=false,assistant_behavior=case when assistant_behavior in ('ignore','human') then 'normal' else assistant_behavior end where organization_id=$1 and id in (select contact_id from conversations where organization_id=$1 and id=any($2::uuid[]))",[session.organization_id,ids]);
    await setConversationMode(db,session.organization_id,id,'active');
    // Invalidate generated work even when the conversation was already active
    // but a contact-level restriction was just lifted.
    await db.query('update conversations set assistant_version=assistant_version+1,assistant_resumed_at=now() where organization_id=$1 and id=any($2::uuid[])',[session.organization_id,ids]);
    await db.query('insert into audit_logs(organization_id,event,resource_id) values($1,$2,$3)',[session.organization_id,input.unstop?'clinic_chat_unstopped_and_resumed':'clinic_assistant_resumed',id]);
    await db.query('commit');return {mode:'active'};
   }catch(error){await db.query('rollback');throw error}finally{db.release()}
  });
 });
 app.get('/status-api/chat-controls',async req=>{
  const session=await sessionFor(req);
  const {search='',filter,offset}=z.object({search:z.string().max(100).optional(),filter:z.enum(['all','allowed','stopped']).default('all'),offset:z.coerce.number().int().min(0).max(100000).default(0)}).strict().parse(req.query);
  const digits=search.replace(/\D/g,'');
  const rows=(await pool.query(`with numbers as (
   select phone from chat_phone_addresses where organization_id=$1
   union select chat_phone(identity) from contacts where organization_id=$1
   union select phone from chat_stopped_numbers where organization_id=$1
  ) select n.phone,coalesce(s.stopped,false) as stopped,(select max(display_name) from contacts c where c.organization_id=$1 and (chat_phone(c.identity)=n.phone or exists(select 1 from chat_phone_addresses a where a.organization_id=$1 and a.jid=c.identity and a.phone=n.phone))) as name from numbers n
   left join chat_stopped_numbers s on s.organization_id=$1 and s.phone=n.phone
   where n.phone is not null and ($2='' or n.phone like '%'||$2||'%') and ($5='' or exists(select 1 from contacts c where c.organization_id=$1 and c.display_name ilike '%'||$5||'%' and (chat_phone(c.identity)=n.phone or exists(select 1 from chat_phone_addresses a where a.organization_id=$1 and a.jid=c.identity and a.phone=n.phone)))) and ($3='all' or coalesce(s.stopped,false)=($3='stopped'))
   and ($3<>'allowed' or not exists(select 1 from contacts p left join conversations c on c.organization_id=p.organization_id and c.contact_id=p.id
    where p.organization_id=$1 and (chat_phone(p.identity)=n.phone or exists(select 1 from chat_phone_addresses a where a.organization_id=$1 and a.account_id=c.account_id and a.jid=p.identity and a.phone=n.phone)) and (p.ai_opt_out or p.assistant_behavior='ignore' or c.mode='paused')))
   order by stopped desc,n.phone limit 31 offset $4`,[session.organization_id,/\d/.test(search)?digits:'',filter,offset,/\d/.test(search)?'':search])).rows;
  return {numbers:rows.slice(0,30),hasMore:rows.length>30,offset};
 });
 app.put('/status-api/chat-controls',async req=>{
  csrf(req);const session=await sessionFor(req);
  const input=z.object({phone:z.string().max(32).transform(phoneNumber).refine(v=>v!==null,'Enter a full phone number including country code, for example +923001234567.'),stopped:z.boolean()}).strict().parse(req.body);
  return privacyGate(session.organization_id,true,async()=>{
   const db=await pool.connect();
   try{
    await db.query('begin');
    const valid=(await db.query('select l.enabled from status_portal_logins l join status_portal_sessions s on s.organization_id=l.organization_id where s.token_hash=$1 and s.organization_id=$2 and s.expires_at>now() for share of l',[session.tokenHash,session.organization_id])).rows[0];
    if(!valid?.enabled)throw new Forbidden();
    if(input.stopped){
     await db.query('insert into chat_stopped_numbers(organization_id,phone) values($1,$2) on conflict(organization_id,phone) do update set stopped=true,stopped_at=now()',[session.organization_id,input.phone]);
     // Drop queued work, including unresolved IDs held closed under an active stop list.
     await db.query("delete from whatsapp_inbox where organization_id=$1 and state<>'done' and chat_is_stopped(organization_id,account_id,customer_jid)",[session.organization_id]);
     await db.query('delete from handoff_unread_requests where organization_id=$1 and chat_is_stopped(organization_id,account_id,customer_jid)',[session.organization_id]);
    }else{
     await db.query('update chat_stopped_numbers set stopped=false where organization_id=$1 and phone=$2',[session.organization_id,input.phone]);
    }
    await db.query('insert into audit_logs(organization_id,event) values($1,$2)',[session.organization_id,input.stopped?'clinic_chat_stopped':'clinic_chat_resumed']);
    await db.query('commit');return {phone:input.phone,stopped:input.stopped};
   }catch(error){await db.query('rollback');throw error}finally{db.release()}
  });
 });
}
