import {equivalentConversations} from './contact-identity.js';
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
 const now=new Date();
 if(!Number.isFinite(time.getTime())||time.getTime()>Date.now()+60000)return;
 return withChatPrivacy(org,account,jid,async()=>{
  const db=await pool.connect();
  try{
   await db.query('begin');
   await db.query('select id from whatsapp_accounts where organization_id=$1 and id=$2 for no key update',[org,account]);
   const seen=await db.query('insert into owner_message_events(organization_id,account_id,customer_jid,external_id,message_at) values($1,$2,$3,$4,$5) on conflict do nothing returning external_id',[org,account,jid,id,time]);
   if(!seen.rowCount){await db.query('commit');console.info('owner_takeover',{event:'duplicate'});return;}
   const contact=(await db.query('insert into contacts(organization_id,identity) values($1,$2) on conflict(organization_id,identity) do update set identity=excluded.identity returning id',[org,jid])).rows[0];
   const c=(await db.query('insert into conversations(organization_id,account_id,contact_id) values($1,$2,$3) on conflict(organization_id,account_id,contact_id) do update set contact_id=excluded.contact_id returning *',[org,account,contact.id])).rows[0];
   const aliases=await equivalentConversations(db,org,c.id);
   // Replayed device history must not undo a later manual resume.
   if(!(await db.query('select 1 from conversations where organization_id=$1 and id=any($2::uuid[]) and (last_owner_message_at >= $3 or (assistant_resumed_at >= $3 and owner_pause_until is null)) limit 1',[org,aliases,time])).rows.length){
    const permanent=(await db.query("select 1 from conversations where organization_id=$1 and id=any($2::uuid[]) and mode='human' and owner_pause_until is null limit 1",[org,aliases])).rows.length>0;
    await db.query("update conversations set mode=case when $4 or $3::timestamptz+interval '30 minutes'>$5 then 'human' else 'active' end,assistant_version=assistant_version+case when $4 or $3::timestamptz+interval '30 minutes'>$5 then 1 else 0 end,handoff_reason=case when $4 then handoff_reason else 'Owner replied on WhatsApp' end,last_owner_message_at=$3,owner_pause_until=case when $4 then null else $3::timestamptz+interval '30 minutes' end where organization_id=$1 and id=any($2::uuid[])",[org,aliases,time,permanent,now]);
    console.info('owner_takeover',{event:'timer_updated',permanent,aliases:aliases.length,pauseUntil:permanent?null:new Date(time.getTime()+1800000).toISOString()});
    await db.query("update whatsapp_inbox set owner_handled_at=now(),state=case when state='pending' then 'done' else state end where organization_id=$1 and account_id=$2 and customer_jid in (select t.identity from conversations c join contacts t on t.organization_id=c.organization_id and t.id=c.contact_id where c.organization_id=$1 and c.id=any($3::uuid[])) and state in ('pending','processing') and ($5 or message_at<$4::timestamptz+interval '30 minutes')",[org,account,aliases,time,permanent]);
    if(permanent||time.getTime()+1800000>now.getTime())await db.query('select queue_attention($1,$2,\'handover\',\'Owner replied on WhatsApp; assistant paused\',$3,\'\',$4)',[org,c.id,text.slice(0,240),'owner:'+account+':'+id]);
   }
   await db.query("insert into messages(organization_id,conversation_id,external_id,sender,content,status,ai_context_source,created_at) values($1,$2,$3,'staff',$4,'sent','unclassified',$5) on conflict do nothing",[org,c.id,id,text.slice(0,8000)||'[WhatsApp attachment]',time]);
   await db.query('commit');
  }catch(e){await db.query('rollback');throw e}finally{db.release()}
 });
}

/** Serialize timer changes with owner sends. Only messages after the quiet window may resume. */
export async function refreshOwnerPause(org:string,account:string,conversation:string,messageAt:Date,now=new Date()){
 const db=await pool.connect();
 try{
  await db.query('begin');
  await db.query('select id from whatsapp_accounts where organization_id=$1 and id=$2 for no key update',[org,account]);
  const ids=await equivalentConversations(db,org,conversation);
  // Explicit resume clears the temporary deadline. Keep its timestamp as an
  // intake watermark so delayed device delivery cannot revive paused messages.
  const resumed=(await db.query("select max(assistant_resumed_at) as at from conversations where organization_id=$1 and id=any($2::uuid[]) and mode='active' and owner_pause_until is null",[org,ids])).rows[0]?.at;
  if(resumed&&messageAt<=new Date(resumed)){
   await db.query("update whatsapp_inbox set owner_handled_at=now(),state=case when state='pending' then 'done' else state end where organization_id=$1 and account_id=$2 and message_at<=$4 and customer_jid in (select t.identity from conversations c join contacts t on t.organization_id=c.organization_id and t.id=c.contact_id where c.organization_id=$1 and c.id=any($3::uuid[])) and state in ('pending','processing')",[org,account,ids,resumed]);
   await db.query('commit');console.info('owner_takeover',{event:'delayed_before_resume'});return true;
  }
  const permanent=(await db.query("select 1 from conversations where organization_id=$1 and id=any($2::uuid[]) and mode='human' and owner_pause_until is null limit 1",[org,ids])).rows.length>0;
  if(permanent){
   await db.query("update conversations set mode='human',owner_pause_until=null where organization_id=$1 and id=any($2::uuid[])",[org,ids]);
   await db.query('commit');return true;
  }
  const rows=(await db.query('select mode,owner_pause_until,last_owner_message_at from conversations where organization_id=$1 and id=any($2::uuid[]) and owner_pause_until is not null order by owner_pause_until desc',[org,ids])).rows;
  const window=rows[0];let suppressed=false;
  if(window){
   const until=new Date(window.owner_pause_until);
   suppressed=messageAt<until;
   if(rows.some((r:any)=>r.mode==='human')&&until>now){
    suppressed=true;
    await db.query("update conversations set mode='human',owner_pause_until=$3,last_owner_message_at=$4,handoff_reason='Owner replied; 30-minute quiet window' where organization_id=$1 and id=any($2::uuid[]) and (mode='active' or owner_pause_until is not null)",[org,ids,until,window.last_owner_message_at]);
   }else if(until<=now&&messageAt>=until){
    await db.query("update conversations set mode='active',handoff_reason=null where organization_id=$1 and id=any($2::uuid[]) and mode='human' and owner_pause_until<=$3",[org,ids,now]);
    await db.query("update attention_events set resolved_at=now() where organization_id=$1 and conversation_id=any($2::uuid[]) and resolved_at is null and category<>'appointment'",[org,ids]);
   }
   // Never send a delayed reply to messages received while the owner was handling it.
   await db.query("update whatsapp_inbox set owner_handled_at=now(),state=case when state='pending' then 'done' else state end where organization_id=$1 and account_id=$2 and message_at<$4 and customer_jid in (select t.identity from conversations c join contacts t on t.organization_id=c.organization_id and t.id=c.contact_id where c.organization_id=$1 and c.id=any($3::uuid[])) and state in ('pending','processing')",[org,account,ids,until]);
  }
  await db.query('commit');if(suppressed)console.info('owner_takeover',{event:'response_suppressed'});return suppressed;
 }catch(e){await db.query('rollback');throw e}finally{db.release()}
}
