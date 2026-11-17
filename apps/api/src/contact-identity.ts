/** A LID is never a phone number. Only PN JIDs and unambiguous transport mappings qualify. */
export const contactPhoneSQL=(contact='p',conversation='c')=>`coalesce(chat_phone(${contact}.identity),(select case when count(distinct a.phone)=1 then min(a.phone) end from chat_phone_addresses a where a.organization_id=${contact}.organization_id and a.account_id=${conversation}.account_id and a.jid=${contact}.identity))`;
export async function conversationIdentities(db:any,org:string,ids?:string[]){
 return (await db.query(`select c.*,p.identity,p.display_name,${contactPhoneSQL()} as phone,
  (select content from messages m where m.organization_id=c.organization_id and m.conversation_id=c.id order by created_at desc limit 1) as last_message,
  (select max(created_at) from messages m where m.organization_id=c.organization_id and m.conversation_id=c.id) as last_activity,
  (select count(*)::int from messages m where m.organization_id=c.organization_id and m.conversation_id=c.id and m.sender='customer' and m.created_at>coalesce(c.last_read_at,'epoch'::timestamptz)) as unread_count
 from conversations c join contacts p on p.organization_id=c.organization_id and p.id=c.contact_id where c.organization_id=$1 and ($2::uuid[] is null or c.id=any($2::uuid[])) order by last_activity desc nulls last limit 500`,[org,ids||null])).rows;
}
export function groupConversations(rows:any[]){
 const groups=new Map<string,any>();
 for(const row of rows){const key=row.phone?row.account_id+'/'+row.phone:row.id;const previous=groups.get(key);
  if(!previous)groups.set(key,{...row,conversation_ids:[row.id],label:row.display_name||(row.phone?'+'+row.phone:'WhatsApp contact'),phone_verified:!!row.phone});
  else{
   const permanent=(previous.mode==='human'&&!previous.owner_pause_until)||(row.mode==='human'&&!row.owner_pause_until);
   previous.conversation_ids.push(row.id);previous.unread_count+=row.unread_count;previous.display_name||=row.display_name;if(previous.display_name)previous.label=previous.display_name;
   if(row.mode==='human')previous.mode='human';
   if(permanent)previous.owner_pause_until=null;
   else if(row.owner_pause_until&&(!previous.owner_pause_until||new Date(row.owner_pause_until)>new Date(previous.owner_pause_until)))previous.owner_pause_until=row.owner_pause_until;
  }
 }return [...groups.values()];
}
export async function equivalentConversations(db:any,org:string,id:string){
 const current=(await db.query(`select c.account_id,${contactPhoneSQL()} as phone from conversations c join contacts p on p.organization_id=c.organization_id and p.id=c.contact_id where c.organization_id=$1 and c.id=$2`,[org,id])).rows[0];
 if(!current)return [];
 if(!current.phone)return [id];
 return (await db.query(`select c.id from conversations c join contacts p on p.organization_id=c.organization_id and p.id=c.contact_id where c.organization_id=$1 and c.account_id=$2 and (c.id=$3 or ${contactPhoneSQL()}=$4)`,[org,current.account_id,id,current.phone])).rows.map((r:any)=>r.id) as string[];
}
