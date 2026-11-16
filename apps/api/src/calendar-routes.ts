import type {FastifyInstance} from 'fastify';
import {randomUUID,createHash} from 'node:crypto';
import {bookingScheduleSchema} from './booking-schedule.js';
import {z} from 'zod';
import {pool} from './db.js';
import {availableCalendars,calendarAccess,calendarCipher,calendarConfig,clearCalendarAccess,digest,googleIdentity,googleTokens,oauthUrl,secret,CALENDAR_SCOPES} from './calendar.js';
type Tenant=(req:any,owner:boolean,fn:(db:any,org:string,actor:string)=>Promise<unknown>)=>Promise<unknown>;
const publicWeb=()=>process.env.WEB_ORIGIN||'http://localhost:3000';
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function page(title:string,message:string,form=''){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>body{font:16px system-ui;background:#faf9f7;color:#252526;margin:0;display:grid;place-items:center;min-height:100vh}.card{background:white;max-width:480px;margin:24px;padding:40px;border:1px solid #e7e5e2;border-radius:20px}h1{font:650 28px system-ui}p{line-height:1.7;color:#73716e}button{border:0;border-radius:9px;background:#e56c32;color:white;padding:15px 22px;font:inherit;cursor:pointer}small{color:#7b8674}</style></head><body><main class="card"><small>CODETIC · GOOGLE CALENDAR</small><h1>${escape(title)}</h1><p>${escape(message)}</p>${form}</main></body></html>`}
function publicHeaders(reply:any){reply.type('text/html').header('Referrer-Policy','no-referrer').header('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://accounts.google.com; base-uri 'none'; frame-ancestors 'none'").header('X-Frame-Options','DENY')}
export function registerCalendarRoutes(app:FastifyInstance,tenant:Tenant){
 app.get('/organizations/:org/calendar',req=>tenant(req,true,async(db,org)=>{
 const cfg=calendarConfig();const connection=(await db.query('select email,calendar_id,calendar_name,timezone,status,booking_enabled,weekdays,opens,closes,duration_minutes,connected_at from calendar_connections where organization_id=$1',[org])).rows[0]||null;
 const invites=(await db.query('select id,expires_at,consumed_at,revoked_at from calendar_invites where organization_id=$1 order by created_at desc limit 5',[org])).rows;
 const appointments=(await db.query('select id,starts_at,ends_at,timezone,status,google_event_url from appointment_requests where organization_id=$1 order by created_at desc limit 20',[org])).rows;
 return {configured:!!cfg,setupRequired:cfg?[]:['Public HTTPS API address','Google OAuth client ID and secret'],callbackPath:'/calendar/oauth/callback',connection,invites,appointments};
 }));
 app.post('/organizations/:org/calendar/invites',req=>tenant(req,true,async(db,org,actor)=>{
 const cfg=calendarConfig();if(!cfg)return {error:'setup_required'};
 const token=secret();await db.query('update calendar_invites set revoked_at=now() where organization_id=$1 and consumed_at is null and revoked_at is null',[org]);
 const row=(await db.query("insert into calendar_invites(organization_id,token_hash,expires_at,created_by) values($1,$2,now()+interval '24 hours',$3) returning id,expires_at",[org,digest(token),actor])).rows[0];
 await db.query("insert into audit_logs(organization_id,actor_id,event,resource_id) values($1,$2,'calendar_link_created',$3)",[org,actor,row.id]);return {...row,url:cfg.base+'/calendar/connect/'+token};
 }));
 app.post('/organizations/:org/calendar/revoke-invites',req=>tenant(req,true,async(db,org)=>{await db.query('update calendar_invites set revoked_at=now() where organization_id=$1 and consumed_at is null',[org]);return {ok:true}}));
 app.get('/organizations/:org/calendar/calendars',req=>tenant(req,true,async(_db,org)=>availableCalendars(await calendarAccess(org))));
 app.patch('/organizations/:org/calendar',req=>tenant(req,true,async(db,org,actor)=>{
 const {calendarId,...schedule}=z.object({calendarId:z.string().min(1).max(300)}).passthrough().parse(req.body);
 const settings={calendarId,...bookingScheduleSchema.parse(schedule)};
 const calendars=await availableCalendars(await calendarAccess(org));const selected=calendars.find((v:any)=>v.id===settings.calendarId);if(!selected)throw Error('Calendar is not writable');
 await db.query('update calendar_connections set calendar_id=$2,calendar_name=$3,timezone=$4,booking_enabled=$5,weekdays=$6,opens=$7,closes=$8,duration_minutes=$9 where organization_id=$1',[org,settings.calendarId,selected.name,settings.timezone,settings.bookingEnabled,[...new Set(settings.weekdays)],settings.opens,settings.closes,settings.durationMinutes]);
 await db.query("insert into audit_logs(organization_id,actor_id,event) values($1,$2,'calendar_settings_updated')",[org,actor]);return {ok:true};
 }));
 app.post('/organizations/:org/calendar/disconnect',req=>tenant(req,true,async(db,org,actor)=>{
 await db.query('delete from calendar_connections where organization_id=$1',[org]);await db.query("update appointment_requests set status='cancelled' where organization_id=$1 and status='proposed'",[org]);await db.query('update calendar_invites set revoked_at=now() where organization_id=$1 and consumed_at is null',[org]);clearCalendarAccess(org);
 await db.query("insert into audit_logs(organization_id,actor_id,event) values($1,$2,'calendar_disconnected')",[org,actor]);return {ok:true};
 }));
 app.get('/calendar/connect/:token',async(req,reply)=>{
 publicHeaders(reply);const token=(req.params as any).token;
 if(!/^[\w-]{43}$/.test(token))return reply.code(404).send(page('Link unavailable','This connection link is invalid.'));
 const row=(await pool.query('select i.*,o.name from calendar_invites i join organizations o on o.id=i.organization_id where token_hash=$1 and consumed_at is null and revoked_at is null and expires_at>now()',[digest(token)])).rows[0];
 if(!row||!calendarConfig())return reply.code(410).send(page('Link unavailable','This link expired or has already been used. Ask the business owner for a fresh link.'));
 return page('Connect '+row.name,'Approve access to check availability and create appointments in your Google Calendar. Your primary calendar will be connected. This does not create a dashboard account. Connection details and appointments are visible to this clinic’s authorized team, including clinic portal users. Proposed and confirmed appointment times are sent to the requesting customer through WhatsApp, where WhatsApp/Meta processes those messages. Customer-authored messages may be processed by DeepSeek for conversation and date/time extraction. Google Calendar credentials, metadata, availability and booking results are excluded from AI prompts.',`<form method="post" action="/calendar/connect/${escape(token)}/start"><p><a href="${escape(publicWeb())}/privacy">Privacy Policy</a> · <a href="${escape(publicWeb())}/terms">Terms of Service</a> · <a href="${escape(publicWeb())}/data-deletion">Data deletion</a></p><label><input type="checkbox" name="data_use_consent" value="approved" required> I authorize this clinic’s team to access the connection and appointment details and agree to the WhatsApp booking messages and customer-message AI processing described above and in the Privacy Policy.</label><p><button>Continue with Google</button></p></form><p><small>Only continue if you recognize this business and expected this link.</small></p>`);
 });
 app.post('/calendar/connect/:token/start',async(req,reply)=>{
 publicHeaders(reply);const cfg=calendarConfig();if(!cfg)return reply.code(503).send(page('Setup pending','The administrator must finish Google Calendar setup.'));
 if(process.env.NODE_ENV==='production'&&(req.body as any)?.data_use_consent!=='approved')return reply.code(400).send(page('Consent required','Review and accept the data-use disclosure before continuing.'));
 const token=(req.params as any).token;if(!/^[\w-]{43}$/.test(token))return reply.code(404).send(page('Invalid link','Request a new connection link.'));
 const invite=(await pool.query('select id from calendar_invites where token_hash=$1 and consumed_at is null and revoked_at is null and expires_at>now()',[digest(token)])).rows[0];if(!invite)return reply.code(410).send(page('Link expired','Request a new connection link.'));
 const state=secret(),browser=secret(),verifier=secret(),id=randomUUID();await pool.query("insert into calendar_oauth_flows(id,invite_id,state_hash,browser_hash,verifier_ciphertext,expires_at,data_use_consented_at,disclosure_version) values($1,$2,$3,$4,$5,now()+interval '10 minutes',case when $6::boolean then now() end,'2026-11-16')",[id,invite.id,digest(state),digest(browser),calendarCipher().seal('calendar-flow:'+id,verifier),(req.body as any)?.data_use_consent==='approved']);
 reply.header('Set-Cookie',`calendar_oauth=${browser}; Path=/calendar/oauth/callback; HttpOnly; SameSite=Lax; Max-Age=600${cfg.base.startsWith('https:')?'; Secure':''}`);
 return reply.redirect(oauthUrl(state,createHash('sha256').update(verifier).digest('base64url')));
 });
 app.get('/calendar/oauth/callback',async(req,reply)=>{
 publicHeaders(reply);const cfg=calendarConfig();reply.header('Set-Cookie',`calendar_oauth=; Path=/calendar/oauth/callback; HttpOnly; SameSite=Lax; Max-Age=0${cfg?.base.startsWith('https:')?'; Secure':''}`);
 try{
 const q=z.object({state:z.string().min(32).max(100),code:z.string().max(4000).optional(),error:z.string().max(200).optional()}).parse(req.query);
 const browser=req.headers.cookie?.match(/(?:^|;\s*)calendar_oauth=([\w-]+)/)?.[1];if(!cfg||!browser)throw Error('Missing browser authorization');
 const flow=(await pool.query('update calendar_oauth_flows set used_at=now() where state_hash=$1 and browser_hash=$2 and used_at is null and expires_at>now() returning *',[digest(q.state),digest(browser)])).rows[0];if(!flow)throw Error('Invalid authorization state');if(process.env.NODE_ENV==='production'&&!flow.data_use_consented_at)throw Error('Data-use consent required');
 if(q.error||!q.code)return reply.code(400).send(page('Connection not approved','No calendar was connected. You can reopen the original link to try again.'));
 const valid=(await pool.query('select organization_id from calendar_invites where id=$1 and consumed_at is null and revoked_at is null and expires_at>now()',[flow.invite_id])).rows[0];if(!valid)throw Error('Invite no longer active');
 const tokens=await googleTokens({grant_type:'authorization_code',code:q.code,redirect_uri:cfg.redirect,code_verifier:calendarCipher().open('calendar-flow:'+flow.id,flow.verifier_ciphertext)});
 const required=CALENDAR_SCOPES.filter(v=>v.startsWith('https://www.googleapis.com/auth/calendar'));if(!tokens.refresh_token||!tokens.id_token||!required.every(v=>String(tokens.scope||'').split(' ').includes(v)))throw Error('Required access not approved');
 const who=await googleIdentity(tokens.id_token);const calendars=await availableCalendars(tokens.access_token);const primary=calendars.find((v:any)=>v.primary);if(!primary)throw Error('Primary writable calendar unavailable');
 const db=await pool.connect();try{await db.query('begin');const invite=(await db.query('select * from calendar_invites where id=$1 for update',[flow.invite_id])).rows[0];if(invite.consumed_at||invite.revoked_at||new Date(invite.expires_at).getTime()<Date.now())throw Error('Invite already used');
 await db.query(`insert into calendar_connections(organization_id,email,google_subject,calendar_id,calendar_name,timezone,token_ciphertext,scopes) values($1,$2,$3,$4,$5,$6,$7,$8)
 on conflict(organization_id) do update set email=excluded.email,google_subject=excluded.google_subject,calendar_id=excluded.calendar_id,calendar_name=excluded.calendar_name,timezone=excluded.timezone,token_ciphertext=excluded.token_ciphertext,scopes=excluded.scopes,status='connected',booking_enabled=false,connected_at=now()`,[invite.organization_id,who.email,who.subject,primary.id,primary.name,primary.timezone||'UTC',calendarCipher().seal('calendar:'+invite.organization_id,tokens.refresh_token),tokens.scope]);
 await db.query('update calendar_invites set consumed_at=now() where id=$1',[invite.id]);await db.query("insert into audit_logs(organization_id,event) values($1,'calendar_connected')",[invite.organization_id]);await db.query('commit');clearCalendarAccess(invite.organization_id);
 }catch(e){await db.query('rollback');throw e}finally{db.release()}
 return page('Calendar connected','Your calendar is connected successfully. You can close this page. No dashboard account was created.');
 }catch{return reply.code(400).send(page('Could not connect','This authorization expired, access was incomplete, or Google could not be reached. Reopen your original link to try again, or request a new link.'))}
 });
}
