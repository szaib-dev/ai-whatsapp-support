import { createHash } from 'node:crypto';
import { pool } from './db.js';
import type { Incoming } from './pipeline.js';
export const MESSAGE_POLICY = { quietMs:1000, maxWaitMs:10000, concurrency:4, maxBatch:20, memoryDays:30 };
export type InboxBatch = { ids:string[]; key:string; session:string; events:Incoming[] };
export interface InboxRepository {
  take(excluded:string[]):Promise<InboxBatch|null>;
  finish(ids:string[],state:'done'|'uncertain'|'pending'|'deferred'):Promise<void>;
}
export class Dispatcher {
  private active = new Map<string,Promise<void>>();
  private timer?:ReturnType<typeof setInterval>;
  private filling=false;
  private stopped=false;
  constructor(private repo:InboxRepository,private deliver:(session:string,event:Incoming)=>Promise<void>){}
  start(){ this.stopped=false;clearInterval(this.timer);this.timer=setInterval(()=>void this.tick(),500); }
  async tick(){
    if(this.filling||this.stopped)return;
    this.filling=true;
    try{
      while(!this.stopped&&this.active.size<MESSAGE_POLICY.concurrency){
        const batch=await this.repo.take([...this.active.keys()]);
        if(!batch)break;
        if(this.stopped){await this.repo.finish(batch.ids,'uncertain');break;}
        const event:Incoming={id:'batch:'+createHash('sha256').update(batch.ids.join(':')).digest('hex'),jid:batch.events[0].jid,text:batch.events.map(e=>e.text).join(' '),parts:batch.events};
        const work=Promise.resolve().then(()=>this.deliver(batch.session,event)).then(()=>this.repo.finish(batch.ids,'done'),(error)=>this.repo.finish(batch.ids,error?.deferred?'deferred':error?.safeToRetry?'pending':'uncertain')).catch(error=>{console.error('Inbox finalization failed',{name:error?.name,code:error?.code});}).finally(()=>this.active.delete(batch.key));
        this.active.set(batch.key,work);
      }
    }catch{ /* Durable pending rows remain available on the next poll. */ }
    finally{this.filling=false;}
  }
  async close(){this.stopped=true;clearInterval(this.timer);while(this.filling)await new Promise(r=>setTimeout(r,20));await Promise.allSettled(this.active.values());}
}
export class PgInbox implements InboxRepository {
  async save(session:string,event:Incoming){
    // The browser and message body cannot assign the organization.
    await pool.query(`with a as (select * from whatsapp_accounts where session_id=$1 and status='connected' and authenticated_jid is not null),
      contact as (insert into contacts(organization_id,identity) select organization_id,$2 from a on conflict(organization_id,identity) do update set identity=excluded.identity returning *),
      conversation as (insert into conversations(organization_id,account_id,contact_id) select a.organization_id,a.id,contact.id from a,contact on conflict(organization_id,account_id,contact_id) do update set contact_id=excluded.contact_id returning *),
      message as (insert into messages(organization_id,conversation_id,external_id,sender,content) select organization_id,id,$3,'customer',$4 from conversation on conflict do nothing)
      insert into whatsapp_inbox(organization_id,account_id,session_id,customer_jid,external_id,content,message_at,owner_handled_at,state)
      select a.organization_id,a.id,a.session_id,$2,$3,$4,$5,
      case when h.handled_through>=$5 or r.external_id is not null then now() end,
      case when h.handled_through>=$5 or r.external_id is not null then 'done' else 'pending' end
      from a left join whatsapp_owner_activity h on h.organization_id=a.organization_id and h.account_id=a.id and h.customer_jid=$2
      left join whatsapp_owner_reads r on r.organization_id=a.organization_id and r.account_id=a.id and r.external_id=$3
      on conflict(organization_id,account_id,external_id) do nothing`,[session,event.jid,event.id,event.text.slice(0,8000),event.timestamp?new Date(event.timestamp):new Date()]);
  }
  async recover(){await pool.query("update whatsapp_inbox set state='uncertain' where state='processing'");}
  async take(excluded:string[]):Promise<InboxBatch|null>{
    const db=await pool.connect();
    try{
      await db.query('begin');
      const candidate=(await db.query(`select i.organization_id,i.account_id,i.session_id,i.customer_jid
        from whatsapp_inbox i join whatsapp_accounts a on a.organization_id=i.organization_id and a.id=i.account_id and a.session_id=i.session_id join organizations o on o.id=i.organization_id
        where i.state='pending' and i.owner_handled_at is null and (not o.reply_only_when_away or a.owner_availability='away') and a.status='connected' and a.removed_at is null and not (i.organization_id::text||'/'||i.account_id::text||'/'||i.customer_jid=any($1::text[]))
        group by i.organization_id,i.account_id,i.session_id,i.customer_jid,o.reply_delay_ms,o.reply_max_wait_ms
        having max(i.received_at)<now()-o.reply_delay_ms*interval '1 millisecond' or min(i.received_at)<now()-o.reply_max_wait_ms*interval '1 millisecond'
        order by min(i.received_at) limit 1`,[excluded])).rows[0];
      if(!candidate){await db.query('commit');return null;}
      const rows=(await db.query(`select * from whatsapp_inbox where organization_id=$1 and account_id=$2 and session_id=$3 and customer_jid=$4 and state='pending' order by received_at,id limit 20 for update skip locked`,[candidate.organization_id,candidate.account_id,candidate.session_id,candidate.customer_jid])).rows;
      let length=0;
      const selected=rows.filter(r=>{length+=r.content.length+1;return length<=8001;});
      if(!selected.length){await db.query('commit');return null;}
      const ids=selected.map(r=>r.id);
      await db.query("update whatsapp_inbox set state='processing',attempts=attempts+1 where organization_id=$1 and id=any($2::uuid[])",[candidate.organization_id,ids]);
      await db.query('commit');
      return {ids,key:`${candidate.organization_id}/${candidate.account_id}/${candidate.customer_jid}`,session:candidate.session_id,events:selected.map(r=>({id:r.external_id,jid:r.customer_jid,text:r.content}))};
    }catch(e){await db.query('rollback').catch(()=>{});throw e;}
    finally{db.release();}
  }
  async finish(ids:string[],state:'done'|'uncertain'|'pending'|'deferred'){await pool.query(`update whatsapp_inbox set state=case when owner_handled_at is not null then 'done' when $2='deferred' then 'pending' when $2='pending' and attempts>=3 then 'failed' else $2 end,attempts=case when $2='deferred' then greatest(0,attempts-1) else attempts end,last_error=case when $2 in ('done','deferred') then null when $2='pending' then 'Processing failed before delivery; safe retry' else 'Delivery result uncertain; review before sending again' end where id=any($1::uuid[])`,[ids,state]);}
}
