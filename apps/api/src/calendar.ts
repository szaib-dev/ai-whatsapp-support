import {createHash,randomBytes} from 'node:crypto';
import {OAuth2Client} from 'google-auth-library';
import {DateTime} from 'luxon';
import {pool} from './db.js';
import {SessionCipher} from './session-crypto.js';
export const CALENDAR_SCOPES=['openid','email','https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events.freebusy'];
export const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export const secret=()=>randomBytes(32).toString('base64url');
export function calendarConfig(){
 const base=process.env.PUBLIC_API_URL?.replace(/\/$/,'');
 if(!base||!process.env.GOOGLE_CLIENT_ID||!process.env.GOOGLE_CLIENT_SECRET||!process.env.SESSION_ENCRYPTION_KEY)return null;
 let url:URL;try{url=new URL(base)}catch{return null;}if(url.origin!==base||url.username||url.password)return null;
 if(url.protocol!=='https:' && !(process.env.NODE_ENV!=='production'&&process.env.CALENDAR_ALLOW_LOCAL_OAUTH==='true'&&['localhost','127.0.0.1'].includes(url.hostname)))return null;
 return {base,redirect:base+'/calendar/oauth/callback',clientId:process.env.GOOGLE_CLIENT_ID,clientSecret:process.env.GOOGLE_CLIENT_SECRET};
}
export function calendarCipher(){return new SessionCipher(process.env.SESSION_ENCRYPTION_KEY!)}
export function oauthUrl(state:string,challenge:string){const cfg=calendarConfig();if(!cfg)throw Error('Calendar setup is incomplete');const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');for(const [k,v] of Object.entries({client_id:cfg.clientId,redirect_uri:cfg.redirect,response_type:'code',scope:CALENDAR_SCOPES.join(' '),access_type:'offline',prompt:'consent',state,code_challenge:challenge,code_challenge_method:'S256'}))url.searchParams.set(k,v);return url.toString()}
export async function googleTokens(params:Record<string,string>){const cfg=calendarConfig();if(!cfg)throw Error('Calendar setup is incomplete');const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...params,client_id:cfg.clientId,client_secret:cfg.clientSecret}),signal:AbortSignal.timeout(12000)});if(!r.ok){const error=await r.json().catch(()=>({}));throw Object.assign(new Error('Google authorization failed'),{reauthorize:['invalid_grant','invalid_client'].includes(error.error)});}return await r.json()}
export async function googleIdentity(idToken:string){const cfg=calendarConfig()!;const ticket=await new OAuth2Client(cfg.clientId).verifyIdToken({idToken,audience:cfg.clientId});const p=ticket.getPayload();if(!p?.sub||!p.email||!p.email_verified)throw Error('Verified Google account required');return {subject:p.sub,email:p.email}}
const accessCache=new Map<string,{token:string;expires:number;credential:string}>();
export function clearCalendarAccess(org:string){accessCache.delete(org)}
export async function calendarAccess(org:string){
 const row=(await pool.query("select * from calendar_connections where organization_id=$1 and status='connected'",[org])).rows[0];if(!row)throw Error('Calendar is disconnected');
 const cached=accessCache.get(org);if(cached&&cached.credential===row.token_ciphertext&&cached.expires>Date.now()+60000)return cached.token;
 const refresh=calendarCipher().open('calendar:'+org,row.token_ciphertext);
 try{const token=await googleTokens({grant_type:'refresh_token',refresh_token:refresh});if(!token.access_token)throw Error('Missing Google token');
  let credential=row.token_ciphertext;
  if(token.refresh_token){credential=calendarCipher().seal('calendar:'+org,token.refresh_token);const changed=await pool.query("update calendar_connections set token_ciphertext=$3 where organization_id=$1 and token_ciphertext=$2 and status='connected' returning organization_id",[org,row.token_ciphertext,credential]);if(!changed.rowCount)throw Error('Calendar connection changed');}
  else if(!(await pool.query("select 1 from calendar_connections where organization_id=$1 and token_ciphertext=$2 and status='connected'",[org,credential])).rows.length)throw Error('Calendar connection changed');
  accessCache.set(org,{token:token.access_token,credential,expires:Date.now()+Math.min(Number(token.expires_in)||3600,3600)*1000});return token.access_token;
 }catch(e){if((e as any)?.reauthorize){clearCalendarAccess(org);await pool.query("update calendar_connections set status='reauthorize' where organization_id=$1 and token_ciphertext=$2",[org,row.token_ciphertext]);}throw e;}
}
export async function googleCalendar(token:string,path:string,body?:unknown,method?:string){const r=await fetch('https://www.googleapis.com/calendar/v3/'+path,{method:method||(body?'POST':'GET'),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});if(!r.ok){if(r.status===401){for(const [org,cached] of accessCache){if(cached.token===token){clearCalendarAccess(org);await pool.query("update calendar_connections set status='reauthorize' where organization_id=$1 and token_ciphertext=$2",[org,cached.credential]);}}}const e=Object.assign(new Error('Google Calendar request failed'),{status:r.status});throw e;}return r.status===204?{}:await r.json()}
export async function availableCalendars(token:string){const body=await googleCalendar(token,'users/me/calendarList?minAccessRole=writer&maxResults=100');return (body.items||[]).map((c:any)=>({id:c.id,name:c.summary,timezone:c.timeZone,primary:!!c.primary}));}
export async function isFree(token:string,calendarId:string,start:string,end:string){const r=await googleCalendar(token,'freeBusy',{timeMin:start,timeMax:end,items:[{id:calendarId}]});const value=r.calendars?.[calendarId];if(!value||value.errors?.length)throw Error('Availability could not be checked');return Array.isArray(value.busy)&&value.busy.length===0;}
export function validateSlot(start:string,end:string,settings:any,now=Date.now()){
 const a=DateTime.fromISO(start,{zone:settings.timezone}),b=DateTime.fromISO(end,{zone:settings.timezone});
 if(!a.isValid||!b.isValid||a.toMillis()<=now||a.toMillis()>now+180*86400000||b.toMillis()<=a.toMillis()||b.diff(a,'minutes').minutes>240)throw Error('Choose a valid future time within 180 days');
 if(a.toISODate()!==b.toISODate()||!settings.weekdays.includes(a.weekday)||a.toFormat('HH:mm')<settings.opens||b.toFormat('HH:mm')>settings.closes)throw Error('That time is outside the configured booking hours');
 return {start:a.toUTC().toISO()!,end:b.toUTC().toISO()!,label:a.toFormat('ccc, dd LLL yyyy, h:mm a')+' – '+b.toFormat('h:mm a')+' ('+settings.timezone+')'};
}
export function appointmentEventId(id:string){return 'appt'+id.replaceAll('-','').toLowerCase()}
