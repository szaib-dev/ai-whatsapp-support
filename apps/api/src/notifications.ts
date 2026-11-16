import {sendNotification} from 'web-push';
import {pool} from './db.js';
import {privacyGate,isChatStopped} from './chat-privacy.js';

export function vapidDetails(){
 const publicKey=process.env.VAPID_PUBLIC_KEY,privateKey=process.env.VAPID_PRIVATE_KEY,subject=process.env.VAPID_SUBJECT;
 return publicKey&&privateKey&&subject?{publicKey,privateKey,subject}:null;
}
// Subscription URLs are capabilities, not arbitrary server-side fetch destinations.
export function validPushEndpoint(input:string){
 try{const u=new URL(input);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(
  u.hostname==='fcm.googleapis.com'||u.hostname==='updates.push.services.mozilla.com'||
  u.hostname.endsWith('.push.services.mozilla.com')||u.hostname==='web.push.apple.com'||
  u.hostname.endsWith('.notify.windows.com'))}catch{return false;}
}
export function notificationPayload(event:any,preview:boolean,portal:boolean){
 const url=new URL(portal?'/status':'/admin',process.env.WEB_ORIGIN||'http://localhost:3000');
 url.searchParams.set('workspace',event.organization_id);
 if(!portal&&event.conversation_id)url.searchParams.set('conversation',event.conversation_id);
 else url.searchParams.set('attention','1');
 preview=preview&&!portal;
 return {id:event.id,title:preview?(event.sender_name||'Codetic AI'):'Codetic AI',
  body:preview?[event.reason,event.preview].filter(Boolean).join(' · '):'Your workspace needs attention. Open Codetic AI to review.',
  tag:'codetic-'+event.id,url:url.pathname+url.search};
}
export type PushSender=(subscription:any,payload:string,options:any)=>Promise<unknown>;
export class PushWorker{
 private timer?:ReturnType<typeof setInterval>;
 private running:Promise<void>|null=null;
 constructor(private send:PushSender=(s,p,o)=>sendNotification(s,p,o)){}
 start(){this.timer=setInterval(()=>void this.tick(),3000);this.timer.unref();void this.tick();}
 tick(){if(this.running)return this.running;this.running=this.deliver().catch(()=>{/* Durable rows retry on the next poll. */}).finally(()=>{this.running=null});return this.running;}
 private async deliver(){
  const vapid=vapidDetails();if(!vapid)return;
  const db=await pool.connect();
  try{
   // One dispatcher across API replicas; pending deliveries survive restarts.
   await db.query('begin');
   const lock=(await db.query('select pg_try_advisory_xact_lock(678123904) as locked')).rows[0];
   if(!lock?.locked){await db.query('commit');return;}
   const rows=(await db.query(`select d.*,e.category,e.reason,e.preview,e.sender_name,e.conversation_id,e.created_at,e.resolved_at,
    s.endpoint,s.keys,s.principal,coalesce(p.enabled,true) as enabled,coalesce(p.include_preview,false) as include_preview,
    coalesce(p.categories,array['urgent','owner','handover','appointment']) as categories,
    c.account_id,t.identity from push_deliveries d
    join attention_events e on e.organization_id=d.organization_id and e.id=d.event_id
    join push_subscriptions s on s.organization_id=d.organization_id and s.id=d.subscription_id
    left join notification_preferences p on p.organization_id=s.organization_id and p.principal=s.principal
    left join conversations c on c.organization_id=e.organization_id and c.id=e.conversation_id
    left join contacts t on t.organization_id=c.organization_id and t.id=c.contact_id
    where d.state='pending' and d.next_attempt_at<=now() order by e.created_at limit 4 for update of d skip locked`)).rows;
   for(const row of rows){
    const preferences=(await db.query('select enabled,include_preview,categories from notification_preferences where organization_id=$1 and principal=$2 for share',[row.organization_id,row.principal])).rows[0];
    if(preferences)Object.assign(row,preferences);
    const portal=row.principal.startsWith('portal:');
    const authorized=portal?(await db.query(`select 1 from status_portal_sessions s join status_portal_logins l on l.organization_id=s.organization_id
      where s.organization_id=$1 and s.token_hash=$2 and s.expires_at>now() and l.enabled for share of s,l`,[row.organization_id,row.principal.slice(7)])).rows.length:
     (await db.query("select 1 from organization_members where organization_id=$1 and user_id=$2 and role='owner' for share",[row.organization_id,row.principal.slice(6)])).rows.length;
    const update=async(state:string,error:string|null=null)=>db.query(`update push_deliveries set state=$3,attempts=attempts+1,last_error=$4,
      next_attempt_at=now()+least(3600,power(2,attempts+1)*10)*interval '1 second' where event_id=$1 and subscription_id=$2`,[row.event_id,row.subscription_id,state,error]);
    if(!authorized||!row.enabled||row.resolved_at||Date.now()-new Date(row.created_at).getTime()>86400000||row.category!=='test'&&!row.categories.includes(row.category)){
     await update('skipped');continue;
    }
    await privacyGate(row.organization_id,false,async()=>{
     if(row.identity&&await isChatStopped(row.organization_id,row.account_id,row.identity)){await update('skipped');return;}
     try{
      await this.send({endpoint:row.endpoint,keys:row.keys},JSON.stringify(notificationPayload({...row,id:row.event_id},row.include_preview,portal)),
       {vapidDetails:vapid,TTL:3600,urgency:row.category==='urgent'?'high':'normal',topic:row.event_id.replaceAll('-',''),timeout:8000});
      await update('sent');
     }catch(e){
      const status=(e as {statusCode?:number}).statusCode;
      if(status===404||status===410){await db.query('delete from push_subscriptions where organization_id=$1 and id=$2',[row.organization_id,row.subscription_id]);}
      else await update(row.attempts>=4?'failed':'pending',status?'Push service '+status:'Push transport unavailable');
     }
    });
   }
   await db.query('commit');
  }catch(e){await db.query('rollback').catch(()=>{});throw e}finally{db.release()}
 }
 async close(){clearInterval(this.timer);await this.running;}
}
