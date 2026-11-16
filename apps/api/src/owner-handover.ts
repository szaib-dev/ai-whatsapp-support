import {pool} from './db.js';
import {withChatPrivacy} from './chat-privacy.js';

/** IDs are persisted BEFORE transport sends; echoes remain recognizable after restart. */
export async function reserveOutbound(org:string,account:string,jid:string,id:string){
 await pool.query('insert into outbound_message_ids(organization_id,account_id,customer_jid,external_id) values($1,$2,$3,$4) on conflict do nothing',[org,account,jid,id]);
}
export async function isGeneratedMessage(org:string,account:string,_jid:string,id:string){
 return (await pool.query(`select 1 from outbound_message_ids where organization_id=$1 and account_id=$2 and external_id=$3
  union all select 1 from messages m join conversations c on c.organization_id=m.organization_id and c.id=m.conversation_id
  join contacts t on t.organization_id=c.organization_id and t.id=c.contact_id
  where m.organization_id=$1 and c.account_id=$2 and m.external_id=$3 and m.sender in ('ai','staff') limit 1`,[org,account,id])).rows.length>0;
}
export async function recordOwnerMessage(org:string,account:string,jid:string,id:string,time:Date,text:string){
 return withChatPrivacy(org,account,jid,async()=>{
  const db=await pool.connect();
  try{
   await db.query('begin');
   await db.query('select id from whatsapp_accounts where organization_id=$1 and id=$2 for no key update',[org,account]);
   const seen=await db.query('insert into owner_message_events(organization_id,account_id,customer_jid,external_id,message_at) values($1,$2,$3,$4,$5) on conflict do nothing returning external_id',[org,account,jid,id,time]);
   if(!seen.rowCount){await db.query('commit');return;}
   const contact=(await db.query('insert into contacts(organization_id,identity) values($1,$2) on conflict(organization_id,identity) do update set identity=excluded.identity returning id',[org,jid])).rows[0];
   const c=(await db.query('insert into conversations(organization_id,account_id,contact_id) values($1,$2,$3) on conflict(organization_id,account_id,contact_id) do update set contact_id=excluded.contact_id returning *',[org,account,contact.id])).rows[0];
   // Replayed device history must not undo a later manual resume.
   if((!c.last_owner_message_at||new Date(c.last_owner_message_at)<time)&&(!c.assistant_resumed_at||new Date(c.assistant_resumed_at)<time)){
    await db.query("update conversations set mode='human',assistant_version=assistant_version+1,handoff_reason='Owner replied on WhatsApp',last_owner_message_at=$3 where organization_id=$1 and id=$2",[org,c.id,time]);
    await db.query("update whatsapp_inbox set owner_handled_at=now(),state=case when state='pending' then 'done' else state end where organization_id=$1 and account_id=$2 and customer_jid=$3 and state in ('pending','processing')",[org,account,jid]);
    await db.query('select queue_attention($1,$2,\'handover\',\'Owner replied on WhatsApp; assistant paused\',$3,\'\',$4)',[org,c.id,text.slice(0,240),'owner:'+account+':'+id]);
   }
   await db.query("insert into messages(organization_id,conversation_id,external_id,sender,content,status,ai_context_source,created_at) values($1,$2,$3,'staff',$4,'sent','unclassified',$5) on conflict do nothing",[org,c.id,id,text.slice(0,8000)||'[WhatsApp attachment]',time]);
   await db.query('commit');
  }catch(e){await db.query('rollback');throw e}finally{db.release()}
 });
}
