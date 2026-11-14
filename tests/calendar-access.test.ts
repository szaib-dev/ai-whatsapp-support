import {afterAll,afterEach,beforeEach,it,expect,vi} from 'vitest';
import {SessionCipher} from '../apps/api/src/session-crypto.js';
const state=vi.hoisted(()=>({rows:new Map<string,any>(),query:vi.fn()}));
vi.mock('../apps/api/src/db.js',()=>({pool:{query:state.query}}));
import {calendarAccess,clearCalendarAccess,googleCalendar} from '../apps/api/src/calendar.js';
const keys=['SESSION_ENCRYPTION_KEY','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','PUBLIC_API_URL'];const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
const key=Buffer.alloc(32,8).toString('base64'),cipher=new SessionCipher(key);
function connect(org:string,refresh:string){state.rows.set(org,{organization_id:org,status:'connected',token_ciphertext:cipher.seal('calendar:'+org,refresh)})}
beforeEach(()=>{
 Object.assign(process.env,{SESSION_ENCRYPTION_KEY:key,GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'secret',PUBLIC_API_URL:'https://api.example.com'});state.rows.clear();clearCalendarAccess('clinic-a');clearCalendarAccess('clinic-b');
 state.query.mockImplementation(async(sql:string,p:any[])=>{
  const row=state.rows.get(p?.[0]);
  if(sql.startsWith('select *'))return {rows:row?.status==='connected'?[{...row}]:[],rowCount:row?.status==='connected'?1:0};
  if(sql.startsWith('select 1'))return {rows:row?.status==='connected'&&row.token_ciphertext===p[1]?[{}]:[],rowCount:row?.status==='connected'&&row.token_ciphertext===p[1]?1:0};
  if(sql.includes("set status='reauthorize'")){if(row?.token_ciphertext===p[1])row.status='reauthorize';return {rows:[],rowCount:1};}
  throw Error('Unexpected query');
 });
});
afterEach(()=>vi.unstubAllGlobals());afterAll(()=>{for(const k of keys)if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k]});
it('keeps access tokens scoped to a clinic and its current Google credential',async()=>{
 connect('clinic-a','refresh-a');connect('clinic-b','refresh-b');
 const fetch=vi.fn(async(_url:any,init:any)=>({ok:true,json:async()=>({access_token:'access-'+new URLSearchParams(String(init.body)).get('refresh_token'),expires_in:3600})}));vi.stubGlobal('fetch',fetch);
 expect(await calendarAccess('clinic-a')).toBe('access-refresh-a');expect(await calendarAccess('clinic-b')).toBe('access-refresh-b');expect(await calendarAccess('clinic-a')).toBe('access-refresh-a');expect(fetch).toHaveBeenCalledTimes(2);
 connect('clinic-a','replacement');expect(await calendarAccess('clinic-a')).toBe('access-replacement');expect(fetch).toHaveBeenCalledTimes(3);
});
it('refuses an in-flight refresh result after the calendar has been disconnected or replaced',async()=>{
 connect('clinic-a','old');let finish!:(v:any)=>void;vi.stubGlobal('fetch',vi.fn(()=>new Promise(resolve=>{finish=resolve})));
 const result=calendarAccess('clinic-a');await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));connect('clinic-a','new');finish({ok:true,json:async()=>({access_token:'old-access',expires_in:3600})});await expect(result).rejects.toThrow('changed');
});
it('marks only the matching connection for reauthorization on a rejected Google access token',async()=>{
 connect('clinic-a','a');connect('clinic-b','b');vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({access_token:'access-a',expires_in:3600})})));await calendarAccess('clinic-a');vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status:401})));await expect(googleCalendar('access-a','freeBusy',{})).rejects.toThrow();expect(state.rows.get('clinic-a').status).toBe('reauthorize');expect(state.rows.get('clinic-b').status).toBe('connected');
});
