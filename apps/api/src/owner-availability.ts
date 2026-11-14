import {pool} from './db.js';
export class OwnerDeferred extends Error {deferred=true;}
export function messageTime(value:any):Date{const n=typeof value==='object'&&value?.toNumber?value.toNumber():Number(value);const ms=n<1e12?n*1000:n;return Number.isFinite(ms)&&ms>0&&ms<Date.now()+60000?new Date(ms):new Date()}
export async function ownerHandled(org:string,account:string,jid:string,through:Date,externalId?:string){
 await pool.query('delete from handoff_unread_requests where organization_id=$1 and account_id=$2 and customer_jid=$3 and created_at<=$4',[org,account,jid,through]);
 if(!(await pool.query('select 1 from organizations where id=$1 and reply_only_when_away',[org])).rows.length)return;
 if(externalId)await pool.query('insert into whatsapp_owner_reads(organization_id,account_id,external_id) values($1,$2,$3) on conflict do nothing',[org,account,externalId]);
 else await pool.query('insert into whatsapp_owner_activity(organization_id,account_id,customer_jid,handled_through) values($1,$2,$3,$4) on conflict(organization_id,account_id,customer_jid) do update set handled_through=greatest(whatsapp_owner_activity.handled_through,excluded.handled_through)',[org,account,jid,through]);
 await pool.query("update whatsapp_inbox set owner_handled_at=now(),state=case when state='pending' then 'done' else state end where organization_id=$1 and account_id=$2 and customer_jid=$3 and state in ('pending','processing') and (($5::text is not null and external_id=$5) or ($5::text is null and message_at<=$4))",[org,account,jid,through,externalId||null]);
 // Read/reply evidence marks only handled messages. Availability is an explicit
 // clinic choice; sync/replay events must never change the global reply mode.
}
