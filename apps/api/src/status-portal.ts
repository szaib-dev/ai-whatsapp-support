import {registerAttentionRoutes} from './attention-routes.js';
import {registerAppointmentManagement,featureEnabled} from './appointment-management.js';
import {registerChatControls} from './chat-controls.js';
import {randomBytes,scrypt as scryptCallback,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {WhatsAppManager} from './whatsapp.js';
import {saveClinicSchedule} from './booking-schedule.js';
import {pool,Forbidden} from './db.js';
const scrypt=promisify(scryptCallback);
export async function hashStatusPassword(password:string){const salt=randomBytes(16).toString('hex');const key=await scrypt(password,salt,64) as Buffer;return 'scrypt:'+salt+':'+key.toString('hex')}
export async function verifyStatusPassword(password:string,hash:string){const [kind,salt,encoded]=hash.split(':');if(kind!=='scrypt'||!salt||!encoded)return false;const expected=Buffer.from(encoded,'hex');const actual=await scrypt(password,salt,64) as Buffer;return actual.length===expected.length&&timingSafeEqual(actual,expected)}
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
const dummyHash='scrypt:00000000000000000000000000000000:'+Buffer.alloc(64).toString('hex');
const cookieName='clinic_status';
function statusCookie(value:string,age:number){const secure=(process.env.WEB_ORIGIN||'').startsWith('https:');return `${cookieName}=${value}; Path=/status-api; HttpOnly; SameSite=Lax; Max-Age=${age}${secure?'; Secure':''}`}
function csrf(req:any){if(req.headers.origin!==(process.env.WEB_ORIGIN||'http://localhost:3000')||req.headers['x-status-request']!=='1')throw new Forbidden()}
async function portalSession(req:any){const token=req.headers.cookie?.match(/(?:^|;\s*)clinic_status=([a-f\d]{64})/)?.[1];if(!token)throw new Forbidden();const row=(await pool.query('select s.organization_id,o.name from status_portal_sessions s join status_portal_logins l on l.organization_id=s.organization_id join organizations o on o.id=s.organization_id where s.token_hash=$1 and s.expires_at>now() and l.enabled',[digest(token)])).rows[0];if(!row)throw new Forbidden();return {...row,tokenHash:digest(token)}}
type Tenant=(req:any,owner:boolean,fn:(db:any,org:string,actor:string)=>Promise<unknown>)=>Promise<unknown>;
export function registerStatusPortal(app:FastifyInstance,tenant:Tenant,whatsapp?:WhatsAppManager){
 registerAttentionRoutes(app,tenant,portalSession,csrf);
 registerChatControls(app,portalSession,csrf);
 registerAppointmentManagement(app,tenant,portalSession,csrf);
 app.get('/organizations/:org/status-access',req=>tenant(req,true,async(db,org)=>({login:(await db.query('select email,enabled,updated_at from status_portal_logins where organization_id=$1',[org])).rows[0]||null,url:(process.env.WEB_ORIGIN||'http://localhost:3000').replace(/\/$/,'')+'/status'})));
 app.put('/organizations/:org/status-access',req=>tenant(req,true,async(db,org,actor)=>{
 const input=z.object({email:z.string().trim().email().max(254).transform(v=>v.toLowerCase()),password:z.string().min(12).max(128).optional(),enabled:z.boolean()}).strict().parse(req.body);
 const duplicate=(await db.query('select 1 from status_portal_logins where email=$1 and organization_id<>$2',[input.email,org])).rows.length;
 if(duplicate)throw new z.ZodError([{code:'custom',path:['email'],message:'This email is already assigned to another clinic status login.'}]);
 const old=(await db.query('select password_hash from status_portal_logins where organization_id=$1 for update',[org])).rows[0];
 if(!old&&!input.password)z.string().min(12,'Set a password of at least 12 characters').parse(input.password);
 const hash=input.password?await hashStatusPassword(input.password):old.password_hash;
 await db.query('insert into status_portal_logins(organization_id,email,password_hash,enabled) values($1,$2,$3,$4) on conflict(organization_id) do update set email=excluded.email,password_hash=excluded.password_hash,credential_version=gen_random_uuid(),enabled=excluded.enabled,failed_attempts=0,locked_until=null,updated_at=now()',[org,input.email,hash,input.enabled]);
 await db.query('delete from status_portal_sessions where organization_id=$1',[org]);await db.query("insert into audit_logs(organization_id,actor_id,event) values($1,$2,'status_portal_access_updated')",[org,actor]);return {ok:true};
 }));
 app.post('/status-api/login',{config:{rateLimit:{max:10,timeWindow:'15 minutes'}}},async(req,reply)=>{
 csrf(req);const input=z.object({email:z.string().trim().email().max(254).transform(v=>v.toLowerCase()),password:z.string().min(1).max(128)}).strict().parse(req.body);
 const login=(await pool.query('select * from status_portal_logins where email=$1',[input.email])).rows[0];
 const valid=await verifyStatusPassword(input.password,login?.password_hash||dummyHash);
 if(!valid||!login?.enabled||(login.locked_until&&new Date(login.locked_until)>new Date())){
 if(login)await pool.query("update status_portal_logins set failed_attempts=failed_attempts+1,locked_until=case when failed_attempts>=4 then now()+interval '15 minutes' else locked_until end where organization_id=$1",[login.organization_id]);
 throw new Forbidden();
 }
 // Lock credentials during session creation so a concurrent admin reset cannot leave a new old-password session.
 const db=await pool.connect();try{await db.query('begin');const current=(await db.query('select password_hash,enabled,credential_version from status_portal_logins where organization_id=$1 for update',[login.organization_id])).rows[0];if(!current?.enabled||current.password_hash!==login.password_hash||current.credential_version!==login.credential_version)throw new Forbidden();
 const token=randomBytes(32).toString('hex');await db.query('delete from status_portal_sessions where expires_at<now()');await db.query("insert into status_portal_sessions(token_hash,organization_id,expires_at) values($1,$2,now()+interval '7 days')",[digest(token),login.organization_id]);await db.query('update status_portal_logins set failed_attempts=0,locked_until=null where organization_id=$1',[login.organization_id]);await db.query('commit');reply.header('Set-Cookie',statusCookie(token,7*86400));return {ok:true};
 }catch(e){await db.query('rollback');throw e}finally{db.release()}
 });
 app.get('/status-api/me',async req=>{const session=await portalSession(req);const accounts=(await pool.query('select id,authenticated_jid,owner_availability,status from whatsapp_accounts where organization_id=$1 and removed_at is null order by id',[session.organization_id])).rows.map(a=>({id:a.id,number:a.authenticated_jid?.split('@')[0]||'Not linked',availability:a.owner_availability,connected:!!whatsapp?.ready&&whatsapp.state(session.organization_id,a.id,a.status)==='connected'}));return {businessName:session.name,accounts};});
 app.patch('/status-api/state',async req=>{
 csrf(req);const {status}=z.object({status:z.enum(['online','offline'])}).strict().parse(req.body);const session=await portalSession(req);const db=await pool.connect();try{await db.query('begin');const valid=(await db.query('select l.enabled from status_portal_logins l join status_portal_sessions s on s.organization_id=l.organization_id where s.token_hash=$1 and s.expires_at>now() for share of l',[session.tokenHash])).rows[0];if(!valid?.enabled)throw new Forbidden();
 await db.query('update organizations set reply_only_when_away=true where id=$1',[session.organization_id]);const updated=await db.query('update whatsapp_accounts set owner_availability=$2,owner_status_at=now() where organization_id=$1 and removed_at is null returning id',[session.organization_id,status==='offline'?'away':'online']);
 await db.query("insert into audit_logs(organization_id,event) values($1,$2)",[session.organization_id,status==='offline'?'clinic_status_offline':'clinic_status_online']);await db.query('commit');return {ok:true,status,numbersUpdated:updated.rowCount};
 }catch(e){await db.query('rollback');throw e}finally{db.release()}
 });
 app.get('/status-api/connections',async req=>{
  const session=await portalSession(req);
  const rows=(await pool.query(`select a.id,a.authenticated_jid,a.status,a.owner_availability,a.desired_connected,a.needs_pairing,a.last_connection_error,
   o.reply_only_when_away,coalesce((select (r.content->>'aiEnabled')::boolean from knowledge_publications p join knowledge_revisions r on r.organization_id=p.organization_id and r.id=p.revision_id where p.organization_id=a.organization_id),true) as ai_enabled,
   exists(select 1 from whatsapp_auth s where s.organization_id=a.organization_id and s.account_id=a.id) as has_credentials
   from whatsapp_accounts a join organizations o on o.id=a.organization_id where a.organization_id=$1 and a.removed_at is null order by a.id`,[session.organization_id])).rows;
  return {serviceReady:!!whatsapp?.ready,accounts:rows.map(a=>{
   const status=whatsapp?.ready?whatsapp.state(session.organization_id,a.id,a.status):'service_recovering';
   const readiness=status==='connected'?(!a.ai_enabled?'ai_disabled':a.reply_only_when_away&&a.owner_availability!=='away'?(a.owner_availability==='online'?'paused_online':'choose_availability'):'ready'):status==='awaiting_scan'?'scan_qr':status==='service_recovering'?'service_recovering':a.needs_pairing?'link_required':a.desired_connected&&a.has_credentials?'recovering':'disconnected';
   return {id:a.id,number:a.authenticated_jid?.split('@')[0]||'Business WhatsApp',status,readiness,qr:whatsapp?.qr(session.organization_id,a.id)||null,lastError:a.last_connection_error,automaticRecovery:a.desired_connected&&!a.needs_pairing&&a.has_credentials};
  })};
 });
 app.post('/status-api/connections/:accountId/connect',async req=>{
  csrf(req);const session=await portalSession(req),account=z.string().uuid().parse((req.params as any).accountId);const db=await pool.connect();
  try{await db.query('begin');const valid=(await db.query('select l.enabled from status_portal_logins l join status_portal_sessions s on s.organization_id=l.organization_id where s.token_hash=$1 and s.expires_at>now() for share of l',[session.tokenHash])).rows[0];if(!valid?.enabled)throw new Forbidden();
   const found=(await db.query('update whatsapp_accounts set desired_connected=true,needs_pairing=false,reconnect_after=null,last_connection_error=null where organization_id=$1 and id=$2 and removed_at is null returning id',[session.organization_id,account])).rows[0];if(!found)throw new Forbidden();
   await db.query("insert into audit_logs(organization_id,event,resource_id) values($1,'clinic_reconnect_requested',$2)",[session.organization_id,account]);await db.query('commit');
  }catch(e){await db.query('rollback');throw e}finally{db.release()}
  if(!whatsapp?.ready){whatsapp?.recover();return {accepted:true,recovering:true};}
  try{await whatsapp.ensureConnected(session.organization_id,account)}catch{return {accepted:true,recovering:true}}
  return {accepted:true,recovering:false};
 });
 app.post('/status-api/connections/:accountId/disconnect',async req=>{
  csrf(req);const session=await portalSession(req),account=z.string().uuid().parse((req.params as any).accountId);const db=await pool.connect();
  try{await db.query('begin');const valid=(await db.query('select l.enabled from status_portal_logins l join status_portal_sessions s on s.organization_id=l.organization_id where s.token_hash=$1 and s.expires_at>now() for share of l',[session.tokenHash])).rows[0];if(!valid?.enabled)throw new Forbidden();
   const found=(await db.query('update whatsapp_accounts set desired_connected=false,reconnect_after=null where organization_id=$1 and id=$2 and removed_at is null returning id',[session.organization_id,account])).rows[0];if(!found)throw new Forbidden();
   await db.query("insert into audit_logs(organization_id,event,resource_id) values($1,'clinic_disconnect_requested',$2)",[session.organization_id,account]);await db.query('commit');
  }catch(e){await db.query('rollback');throw e}finally{db.release()}
  await whatsapp?.stop(session.organization_id,account);
  return {ok:true};
 });
 app.get('/status-api/schedule',async req=>{
  const session=await portalSession(req);
  const connection=(await pool.query('select calendar_name as "calendarName",status,timezone,booking_enabled as "bookingEnabled",weekdays,opens,closes,duration_minutes as "durationMinutes" from calendar_connections where organization_id=$1',[session.organization_id])).rows[0]||null;
  const appointments=(await pool.query('select id,starts_at as "startsAt",ends_at as "endsAt",timezone,status from appointment_requests where organization_id=$1 and kind=\'appointment\' order by case when starts_at>now() then 0 else 1 end,case when starts_at>now() then starts_at end asc,starts_at desc limit 100',[session.organization_id])).rows;
  return {connection,appointments,advancedAppointments:await featureEnabled(pool,session.organization_id)};
 });
 app.patch('/status-api/schedule',async req=>{
  csrf(req);const session=await portalSession(req),db=await pool.connect();
  try{await db.query('begin');const valid=(await db.query('select l.enabled from status_portal_logins l join status_portal_sessions s on s.organization_id=l.organization_id where s.token_hash=$1 and s.expires_at>now() for share of l',[session.tokenHash])).rows[0];if(!valid?.enabled)throw new Forbidden();
   const result=await saveClinicSchedule(db,session.organization_id,req.body);
   await db.query("insert into audit_logs(organization_id,event) values($1,'clinic_schedule_updated')",[session.organization_id]);await db.query('commit');return result;
  }catch(e){await db.query('rollback');throw e}finally{db.release()}
 });
 app.post('/status-api/logout',async(req,reply)=>{csrf(req);const token=req.headers.cookie?.match(/(?:^|;\s*)clinic_status=([a-f\d]{64})/)?.[1];if(token)await pool.query('delete from status_portal_sessions where token_hash=$1',[digest(token)]);reply.header('Set-Cookie',statusCookie('',0));return {ok:true}});
}
