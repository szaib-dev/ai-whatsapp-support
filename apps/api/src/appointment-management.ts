import type {FastifyInstance} from 'fastify';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {pool,Forbidden} from './db.js';
import {calendarAccess,googleCalendar,appointmentEventId,validateSlot} from './calendar.js';

export const ADVANCED_APPOINTMENTS='advanced_appointments';
export async function featureEnabled(db:any,org:string){return !!(await db.query('select enabled from workspace_features where organization_id=$1 and feature_key=$2',[org,ADVANCED_APPOINTMENTS])).rows[0]?.enabled;}
const invalid=(message:string)=>new z.ZodError([{code:'custom',path:[],message}]);
export const appointmentInput=z.object({requestKey:z.string().uuid(),title:z.string().trim().min(1).max(160),customerName:z.string().trim().max(160).default(''),notes:z.string().trim().max(2000).default(''),kind:z.enum(['appointment','blocked']).default('appointment'),startsAt:z.iso.datetime({offset:true}),endsAt:z.iso.datetime({offset:true})}).strict();
type Session=(req:any)=>Promise<{organization_id:string;tokenHash:string}>;
type Tenant=(req:any,owner:boolean,fn:(db:any,org:string,actor:string)=>Promise<unknown>)=>Promise<unknown>;

// Serialize with the existing assistant's calendar row lock. A durable reservation is
// committed before Google I/O; uncertain outcomes continue to occupy the slot.
export async function reserveAppointment(db:any,org:string,input:z.infer<typeof appointmentInput>,id?:string){
 const settings=(await db.query('select * from calendar_connections where organization_id=$1 for update',[org])).rows[0];
 if(!settings||settings.status!=='connected')throw invalid('Connect Google Calendar before managing appointments.');
 const existing=id?(await db.query('select * from appointment_requests where organization_id=$1 and id=$2 for update',[org,id])).rows[0]:(await db.query('select * from appointment_requests where organization_id=$1 and request_key=$2',[org,input.requestKey])).rows[0];
 if(id&&!existing)throw new Forbidden();
 if(!id&&existing){
  if(existing.title!==input.title||existing.customer_name!==input.customerName||existing.notes!==input.notes||existing.kind!==input.kind||new Date(existing.starts_at).getTime()!==Date.parse(input.startsAt)||new Date(existing.ends_at).getTime()!==Date.parse(input.endsAt))throw invalid('This request was already saved with different details. Refresh the list before editing it.');
  return existing;
 }
 if(existing&&existing.status!=='booked')throw invalid('Resolve this appointment’s Calendar sync before editing it.');
 let slot;try{slot=validateSlot(input.startsAt,input.endsAt,settings)}catch(e){throw invalid((e as Error).message)}
 const overlap=(await db.query("select 1 from appointment_requests where organization_id=$1 and ($2::uuid is null or id<>$2) and status in ('creating','booked','uncertain') and starts_at<$4 and ends_at>$3 limit 1",[org,id||null,slot.start,slot.end])).rows.length;
 if(overlap)throw invalid('This time overlaps an appointment or blocked slot. Choose another time.');
 const values=[org,id||randomUUID(),slot.start,slot.end,settings.timezone,settings.calendar_id,input.title,input.customerName,input.notes,input.kind,input.requestKey];
 if(id)return (await db.query("update appointment_requests set starts_at=$3,ends_at=$4,title=$5,customer_name=$6,notes=$7,kind=$8,timezone=$9,status='creating',sync_action='save' where organization_id=$1 and id=$2 returning *",[org,id,slot.start,slot.end,input.title,input.customerName,input.notes,input.kind,settings.timezone])).rows[0];
 return (await db.query("insert into appointment_requests(organization_id,id,starts_at,ends_at,timezone,calendar_id,title,customer_name,notes,kind,request_key,source_event,status,sync_action) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::uuid,$11::text,'creating','save') returning *",values)).rows[0];
}
export async function syncAppointment(org:string,id:string){
 const db=await pool.connect();
 try{
  await db.query('begin');
  await db.query('select organization_id from calendar_connections where organization_id=$1 for update',[org]);
  const row=(await db.query('select * from appointment_requests where organization_id=$1 and id=$2 for update',[org,id])).rows[0];
  if(!row)throw new Forbidden();
  if(!row.sync_action){await db.query('commit');return {ok:true,status:row.status};}
  try{
   const token=await calendarAccess(org,db),eventId=row.google_event_id||appointmentEventId(id);
   const path='calendars/'+encodeURIComponent(row.calendar_id)+'/events';
   if(row.sync_action==='cancel'){
    try{await googleCalendar(token,path+'/'+eventId,undefined,'DELETE',db)}catch(e){if(![404,410].includes((e as any).status))throw e;}
    await db.query("update appointment_requests set status='cancelled',sync_action=null where organization_id=$1 and id=$2",[org,id]);
   }else{
    // Events-list excludes this appointment itself, unlike a freeBusy response.
    let pageToken:string|undefined;
    do{
     const params=new URLSearchParams({timeMin:new Date(row.starts_at).toISOString(),timeMax:new Date(row.ends_at).toISOString(),singleEvents:'true',maxResults:'2500',fields:'items(id,status,transparency),nextPageToken',...(pageToken?{pageToken}:{})});
     const events=await googleCalendar(token,path+'?'+params,undefined,undefined,db);
     if((events.items||[]).some((e:any)=>e.id!==eventId&&e.status!=='cancelled'&&e.transparency!=='transparent'))throw invalid('Google Calendar has a conflicting event. Resolve it, then retry sync.');
     pageToken=events.nextPageToken;
    }while(pageToken);
    const event={summary:row.kind==='blocked'?'Unavailable':row.title,start:{dateTime:new Date(row.starts_at).toISOString(),timeZone:row.timezone},end:{dateTime:new Date(row.ends_at).toISOString(),timeZone:row.timezone},extendedProperties:{private:{codeticRequest:id,codeticOrganization:org}}};
    let remote;
    try{remote=await googleCalendar(token,path+'/'+eventId,undefined,undefined,db)}catch(e){if((e as any).status!==404)throw e;}
    if(remote&&remote.extendedProperties?.private?.codeticRequest!==id)throw Error('Calendar event identity mismatch');
    const result=remote?await googleCalendar(token,path+'/'+eventId,event,'PATCH',db):await googleCalendar(token,path,{id:eventId,...event},undefined,db);
    if(result.id!==eventId||result.status==='cancelled')throw Error('Unverified Calendar response');
    await db.query("update appointment_requests set status='booked',google_event_id=$3,google_event_url=$4,sync_action=null where organization_id=$1 and id=$2",[org,id,eventId,result.htmlLink||null]);
   }
   await db.query("insert into audit_logs(organization_id,event,resource_id) values($1,$2,$3)",[org,row.sync_action==='cancel'?'appointment_cancelled':'appointment_managed',id]);
   await db.query('commit');return {ok:true};
  }catch{
   await db.query("update appointment_requests set status='uncertain' where organization_id=$1 and id=$2",[org,id]);
   await db.query('commit');return {ok:false,status:'uncertain',message:'Calendar sync needs attention. Your time is reserved. Resolve any Calendar conflict and retry sync; do not create another booking.'};
  }
 }catch(e){await db.query('rollback');throw e}finally{db.release()}
}
export function registerAppointmentManagement(app:FastifyInstance,tenant:Tenant,session:Session,csrf:(req:any)=>void){
 app.get('/organizations/:org/features',req=>tenant(req,true,async(db,org)=>({advancedAppointments:await featureEnabled(db,org)})));
 app.patch('/organizations/:org/features/:key',req=>tenant(req,true,async(db,org,actor)=>{
  const key=z.literal(ADVANCED_APPOINTMENTS).parse((req.params as any).key),{enabled}=z.object({enabled:z.boolean()}).strict().parse(req.body);
  await db.query('insert into workspace_features(organization_id,feature_key,enabled,updated_by) values($1,$2,$3,$4) on conflict(organization_id,feature_key) do update set enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=now()',[org,key,enabled,actor]);
  await db.query("insert into audit_logs(organization_id,actor_id,event) values($1,$2,$3)",[org,actor,enabled?'advanced_appointments_enabled':'advanced_appointments_disabled']);return {ok:true};
 }));
 async function portal(req:any,fn:(db:any,org:string)=>Promise<any>){
  if(req.method!=='GET')csrf(req);const s=await session(req),db=await pool.connect();
  try{await db.query('begin');
   const valid=(await db.query('select l.enabled from status_portal_logins l join status_portal_sessions s on s.organization_id=l.organization_id where s.token_hash=$1 and s.expires_at>now() for share of l',[s.tokenHash])).rows[0];
   if(!valid?.enabled)throw new Forbidden();
   const feature=(await db.query('select enabled from workspace_features where organization_id=$1 and feature_key=$2 for share',[s.organization_id,ADVANCED_APPOINTMENTS])).rows[0];
   if(!feature?.enabled)throw new Forbidden();
   const result=await fn(db,s.organization_id);await db.query('commit');return result;
  }catch(e){await db.query('rollback');throw e}finally{db.release()}
 }
 app.get('/status-api/appointments',req=>portal(req,async(db,org)=>({appointments:(await db.query('select id,title,customer_name as "customerName",notes,kind,starts_at as "startsAt",ends_at as "endsAt",timezone,status,sync_action as "syncAction" from appointment_requests where organization_id=$1 and starts_at>now()-interval \'365 days\' order by starts_at limit 2000',[org])).rows})));
 app.post('/status-api/appointments',async req=>{const row=await portal(req,(db,org)=>reserveAppointment(db,org,appointmentInput.parse(req.body)));return syncAppointment(row.organization_id,row.id)});
 app.patch('/status-api/appointments/:id',async req=>{const row=await portal(req,(db,org)=>reserveAppointment(db,org,appointmentInput.parse(req.body),z.string().uuid().parse((req.params as any).id)));return syncAppointment(row.organization_id,row.id)});
 app.post('/status-api/appointments/:id/:action',async req=>{
  const action=z.enum(['cancel','sync']).parse((req.params as any).action);
  const result=await portal(req,async(db,org)=>{
   const id=z.string().uuid().parse((req.params as any).id);
   await db.query('select organization_id from calendar_connections where organization_id=$1 for update',[org]);
   const row=(await db.query('select * from appointment_requests where organization_id=$1 and id=$2 for update',[org,id])).rows[0];if(!row)throw new Forbidden();
   if(action==='cancel'){
    if(!['booked','uncertain'].includes(row.status)&&!(row.status==='creating'&&row.sync_action))throw invalid('This booking is still being confirmed. Wait for confirmation before cancelling.');
    await db.query("update appointment_requests set sync_action='cancel',status='creating' where organization_id=$1 and id=$2",[org,id]);
   }
   return {org,id};
  });return syncAppointment(result.org,result.id);
 });
}
