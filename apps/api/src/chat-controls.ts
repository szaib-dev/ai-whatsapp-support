import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {pool,Forbidden} from './db.js';
import {phoneNumber,privacyGate} from './chat-privacy.js';
type Session={organization_id:string;tokenHash:string};
export function registerChatControls(app:FastifyInstance,sessionFor:(req:any)=>Promise<Session>,csrf:(req:any)=>void){
 app.get('/status-api/chat-controls',async req=>{
  const session=await sessionFor(req);
  const {search=''}=z.object({search:z.string().max(30).regex(/^[+0-9 ()-]*$/).optional()}).strict().parse(req.query);
  const digits=search.replace(/\D/g,'');
  const rows=(await pool.query(`with numbers as (
   select phone from chat_phone_addresses where organization_id=$1
   union select chat_phone(identity) from contacts where organization_id=$1
   union select phone from chat_stopped_numbers where organization_id=$1
  ) select n.phone,coalesce(s.stopped,false) as stopped from numbers n
   left join chat_stopped_numbers s on s.organization_id=$1 and s.phone=n.phone
   where n.phone is not null and n.phone like '%'||$2||'%' order by stopped desc,n.phone limit 101`,[session.organization_id,digits])).rows;
  return {numbers:rows.slice(0,100),hasMore:rows.length>100};
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
