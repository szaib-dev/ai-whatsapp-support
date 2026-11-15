import {AsyncLocalStorage} from 'node:async_hooks';
import {pool,privacyLocks} from './db.js';
type Lease={controller:AbortController;held:boolean};
const active=new AsyncLocalStorage<Map<string,Lease>>();
export function phoneNumber(input:string){
 const raw=input.trim();
 if(!/^(?:\+|00)?[0-9 ()-]+$/.test(raw))return null;
 const digits=raw.replace(/\D/g,'').replace(/^00/,'');
 return /^[1-9][0-9]{6,14}$/.test(digits)?digits:null;
}
export function phoneFromJid(jid:string){return /^([1-9][0-9]{6,14})(?::[0-9]+)?@s\.whatsapp\.net$/.exec(jid)?.[1]||null;}
export function privacySignal(timeoutMs:number){
 const signals=[AbortSignal.timeout(timeoutMs),...[...(active.getStore()?.values()||[])].filter(s=>s.held).map(s=>s.controller.signal)];
 return AbortSignal.any(signals);
}
export function assertPrivacyLease(){for(const state of active.getStore()?.values()||[])if(state.held)state.controller.signal.throwIfAborted();}
// Session-level advisory locks require the same direct/session-pooled DB endpoint
// already required by the WhatsApp singleton lease. Stop waits for readers to drain.
export async function privacyGate<T>(org:string,exclusive:boolean,fn:()=>Promise<T>):Promise<T>{
 const inherited=active.getStore()?.get(org);
 if(inherited?.held){inherited.controller.signal.throwIfAborted();if(exclusive)throw Error('Cannot change privacy inside message processing');return fn();}
 const client=await privacyLocks.connect(),controller=new AbortController();
 const state:Lease={controller,held:false};
 let acquired=false,broken=false;
 const failed=()=>{broken=true;controller.abort(Error('Privacy lease interrupted'));};
 client.on('error',failed);
 try{
  try{await client.query(`select pg_advisory_lock${exclusive?'':'_shared'}(hashtextextended($1,678123903))`,[org]);}
  catch(error){broken=true;throw error;} // Acquisition can be ambiguous after network failure.
  acquired=true;state.held=true;controller.signal.throwIfAborted();
  const scope=new Map(active.getStore());scope.set(org,state);
  const value=await active.run(scope,fn);controller.signal.throwIfAborted();return value;
 }finally{
  // Timers inherit AsyncLocalStorage; after release they must obtain a fresh lock.
  state.held=false;
  if(acquired&&!broken){try{await client.query(`select pg_advisory_unlock${exclusive?'':'_shared'}(hashtextextended($1,678123903))`,[org]);}catch{broken=true;}}
  client.removeListener('error',failed);client.release(broken);
 }
}
export async function isChatStopped(org:string,account:string,jid:string,timestamp?:number){
 // Query failures propagate; a missing privacy table never falls back to processing.
 return (await pool.query('/* chat privacy */ select 1 where chat_is_stopped($1,$2,$3,$4)',[org,account,jid,timestamp?new Date(timestamp):null])).rows.length>0;
}
export async function withChatPrivacy<T>(org:string,account:string,jid:string,fn:()=>Promise<T>,timestamp?:number){
 return privacyGate(org,false,async()=>{if(await isChatStopped(org,account,jid,timestamp))return;assertPrivacyLease();return fn();});
}
export async function rememberPhone(org:string,account:string,jid:string,phone:string){
 await pool.query('insert into chat_phone_addresses(organization_id,account_id,jid,phone) values($1,$2,$3,$4) on conflict(organization_id,account_id,jid) do update set phone=excluded.phone where chat_phone_addresses.phone<>excluded.phone',[org,account,jid,phone]);
}
