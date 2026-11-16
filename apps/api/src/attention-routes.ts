import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {pool,Forbidden} from './db.js';
import {validPushEndpoint,vapidDetails} from './notifications.js';

type Tenant=(req:any,owner:boolean,fn:(db:any,org:string,actor:string)=>Promise<unknown>)=>Promise<unknown>;
type Portal=(req:any)=>Promise<{organization_id:string;tokenHash:string}>;
const uuid=z.string().uuid();
const subscriptionInput=z.object({endpoint:z.string().max(2048).refine(validPushEndpoint,'Unsupported push service'),
 keys:z.object({p256dh:z.string().regex(/^[A-Za-z0-9_-]{87,88}$/),auth:z.string().regex(/^[A-Za-z0-9_-]{22}$/)}).strict()}).strict();
export async function setConversationMode(db:any,org:string,id:string,mode:string){
 const row=(await db.query('update conversations set mode=$3,handoff_reason=case when $3=\'active\' then null else \'Manually taken over\' end where organization_id=$1 and id=$2 returning account_id,contact_id',[org,id,mode])).rows[0];
 if(!row)throw new Forbidden();
 // Resuming starts from NEW incoming messages, never replies to a queue from before takeover.
 await db.query(`update whatsapp_inbox i set state='done',owner_handled_at=now() from contacts c
  where c.organization_id=$1 and c.id=$3 and i.organization_id=$1 and i.account_id=$2 and i.customer_jid=c.identity and i.state in ('pending','processing')`,[org,row.account_id,row.contact_id]);
 await db.query('update attention_events set resolved_at=now() where organization_id=$1 and conversation_id=$2 and resolved_at is null and category<>\'appointment\'',[org,id]);
 return {mode};
}
export function registerAttentionRoutes(app:FastifyInstance,tenant:Tenant,portalSession:Portal,csrf:(req:any)=>void){
 function install(prefix:string,portal:boolean){
  async function scope(req:any,fn:(db:any,org:string,principal:string)=>Promise<any>){
   if(!portal)return tenant(req,true,(db,org,actor)=>fn(db,org,'admin:'+actor));
   if(req.method!=='GET')csrf(req);
   const session=await portalSession(req),db=await pool.connect();
   try{await db.query('begin');
    const valid=(await db.query(`select 1 from status_portal_sessions s join status_portal_logins l on l.organization_id=s.organization_id
      where s.organization_id=$1 and s.token_hash=$2 and s.expires_at>now() and l.enabled for share of s,l`,[session.organization_id,session.tokenHash])).rows[0];
    if(!valid)throw new Forbidden();
    const result=await fn(db,session.organization_id,'portal:'+session.tokenHash);await db.query('commit');return result;
   }catch(e){await db.query('rollback');throw e}finally{db.release()}
  }
  app.get(prefix+'/attention',req=>scope(req,async(db,org,principal)=>{
   const events=(await db.query(`select e.* from attention_events e left join conversations c on c.organization_id=e.organization_id and c.id=e.conversation_id
    left join contacts t on t.organization_id=c.organization_id and t.id=c.contact_id
    where e.organization_id=$1 and (c.id is null or not chat_is_stopped(c.organization_id,c.account_id,t.identity))
    order by e.created_at desc limit 100`,[org])).rows;
   const conversations=(await db.query(`select c.id,c.mode,c.handoff_reason,t.display_name,t.identity,t.assistant_behavior,
    (select content from messages m where m.organization_id=c.organization_id and m.conversation_id=c.id order by created_at desc limit 1) as last_message
    from conversations c join contacts t on t.organization_id=c.organization_id and t.id=c.contact_id
    where c.organization_id=$1 and not chat_is_stopped(c.organization_id,c.account_id,t.identity) order by (c.mode='human') desc,c.id limit 100`,[org])).rows;
   const preferences=(await db.query('select enabled,include_preview,categories from notification_preferences where organization_id=$1 and principal=$2',[org,principal])).rows[0]||{enabled:true,include_preview:false,categories:['urgent','owner','handover','appointment']};
   const deliveries=(await db.query(`select d.state,count(*)::int as count from push_deliveries d join push_subscriptions s on s.organization_id=d.organization_id and s.id=d.subscription_id
    where d.organization_id=$1 and s.principal=$2 group by d.state`,[org,principal])).rows;
   return {events,conversations,preferences,deliveries,publicKey:vapidDetails()?.publicKey||null};
  }));
  app.post(prefix+'/attention/:id/read',req=>scope(req,async(db,org)=>{
   await db.query('update attention_events set resolved_at=now() where organization_id=$1 and id=$2',[org,uuid.parse((req.params as any).id)]);return {ok:true};
  }));
  app.get(prefix+'/attention/conversations/:id',req=>scope(req,async(db,org)=>{
   const id=uuid.parse((req.params as any).id);
   const c=(await db.query(`select c.id,c.mode,c.handoff_reason,t.display_name,t.identity from conversations c
    join contacts t on t.organization_id=c.organization_id and t.id=c.contact_id where c.organization_id=$1 and c.id=$2
    and not chat_is_stopped(c.organization_id,c.account_id,t.identity)`,[org,id])).rows[0];
   if(!c)throw new Forbidden();
   return {conversation:c,messages:(await db.query('select id,sender,content,created_at from messages where organization_id=$1 and conversation_id=$2 order by created_at desc limit 60',[org,id])).rows.reverse()};
  }));
  app.post(prefix+'/attention/conversations/:id/mode',req=>scope(req,async(db,org)=>{
   const id=uuid.parse((req.params as any).id),{mode}=z.object({mode:z.enum(['active','human'])}).strict().parse(req.body);
   const result=await setConversationMode(db,org,id,mode);
   await db.query('insert into audit_logs(organization_id,event,resource_id) values($1,$2,$3)',[org,'conversation_'+mode,id]);return result;
  }));
  app.get(prefix+'/vip-contacts',req=>scope(req,async(db,org)=>{
   const {search=''}=z.object({search:z.string().trim().max(100).optional()}).strict().parse(req.query);
   return (await db.query(`select id,identity,display_name,assistant_behavior,assistant_instructions,ai_opt_out from contacts
    where organization_id=$1 and (identity ilike $2 or coalesce(display_name,'') ilike $2) order by display_name nulls last,identity limit 100`,[org,'%'+search.replace(/[\\%_]/g,'\\$&')+'%'])).rows;
  }));
  app.patch(prefix+'/vip-contacts/:id',req=>scope(req,async(db,org)=>{
   const id=uuid.parse((req.params as any).id),v=z.object({behavior:z.enum(['normal','ignore','notify','human']),instructions:z.string().trim().max(2000),name:z.string().trim().max(120)}).strict().parse(req.body);
   await db.query('select id from whatsapp_accounts where organization_id=$1 for no key update',[org]);
   const r=await db.query('update contacts set assistant_behavior=$3,assistant_instructions=$4,display_name=nullif($5,\'\') where organization_id=$1 and id=$2 returning id',[org,id,v.behavior,v.instructions,v.name]);
   if(!r.rowCount)throw new Forbidden();
   await db.query(`update conversations set assistant_version=assistant_version+1,mode=case when $3='human' then 'human' else mode end,
    handoff_reason=case when $3='human' then 'Contact requires human assistance' else handoff_reason end where organization_id=$1 and contact_id=$2`,[org,id,v.behavior]);
   await db.query(`update whatsapp_inbox i set state='done',owner_handled_at=now() from contacts t where t.organization_id=$1 and t.id=$2
    and i.organization_id=$1 and i.customer_jid=t.identity and i.state in ('pending','processing')`,[org,id]);
   await db.query("insert into audit_logs(organization_id,event,resource_id) values($1,'contact_preferences_updated',$2)",[org,id]);return {ok:true};
  }));
  app.put(prefix+'/notification-preferences',req=>scope(req,async(db,org,principal)=>{
   const v=z.object({enabled:z.boolean(),include_preview:z.boolean(),categories:z.array(z.enum(['urgent','owner','handover','appointment'])).max(4)}).strict().parse(req.body);
   await db.query(`insert into notification_preferences(organization_id,principal,enabled,include_preview,categories) values($1,$2,$3,$4,$5)
    on conflict(organization_id,principal) do update set enabled=excluded.enabled,include_preview=excluded.include_preview,categories=excluded.categories`,[org,principal,v.enabled,v.include_preview,v.categories]);return {ok:true};
  }));
  app.post(prefix+'/push-subscriptions',req=>scope(req,async(db,org,principal)=>{
   const v=subscriptionInput.parse(req.body);if(!vapidDetails())throw new z.ZodError([{code:'custom',path:[],message:'Web Push is not configured on this server.'}]);
   await db.query('insert into notification_preferences(organization_id,principal) values($1,$2) on conflict do nothing',[org,principal]);
   const count=(await db.query('select count(*)::int n from push_subscriptions where organization_id=$1 and principal=$2',[org,principal])).rows[0].n;
   if(count>=10&&!(await db.query('select 1 from push_subscriptions where organization_id=$1 and principal=$2 and endpoint=$3',[org,principal,v.endpoint])).rows.length)throw new z.ZodError([{code:'custom',path:[],message:'Remove an old device before registering another.'}]);
   // An endpoint can belong to only one signed-in recipient/workspace at a time.
   await db.query('delete from push_subscriptions where endpoint=$1 and (organization_id<>$2 or principal<>$3)',[v.endpoint,org,principal]);
   await db.query(`insert into push_subscriptions(organization_id,principal,endpoint,keys) values($1,$2,$3,$4)
    on conflict(endpoint) do update set keys=excluded.keys`,[org,principal,v.endpoint,JSON.stringify(v.keys)]);return {ok:true};
  }));
  app.delete(prefix+'/push-subscriptions',req=>scope(req,async(db,org,principal)=>{
   const {endpoint}=z.object({endpoint:z.string().max(2048).optional()}).strict().parse(req.body||{});
   await db.query('delete from push_subscriptions where organization_id=$1 and principal=$2 and ($3::text is null or endpoint=$3)',[org,principal,endpoint||null]);return {ok:true};
  }));
  app.post(prefix+'/push-test',req=>scope(req,async(db,org,principal)=>{
   if(!(await db.query('select 1 from push_subscriptions where organization_id=$1 and principal=$2',[org,principal])).rows.length)throw new z.ZodError([{code:'custom',path:[],message:'Enable notifications on this device first.'}]);
   const event=(await db.query(`insert into attention_events(organization_id,category,reason,dedup_key) values($1,'test','Test notification from Codetic AI','test:'||gen_random_uuid()) returning id`,[org])).rows[0];
   await db.query('delete from push_deliveries d using push_subscriptions s where d.subscription_id=s.id and d.event_id=$1 and s.principal<>$2',[event.id,principal]);return {ok:true};
  }));
 }
 install('/organizations/:org',false);install('/status-api',true);
}
