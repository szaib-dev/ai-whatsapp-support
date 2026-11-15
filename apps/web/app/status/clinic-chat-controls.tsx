"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
type NumberControl={phone:string;stopped:boolean};
type State={numbers:NumberControl[];hasMore:boolean};
export default function ClinicChatControls({api}:{api:(path:string,body?:unknown,method?:string)=>Promise<any>}){
 const [state,setState]=useState<State|null>(null),[search,setSearch]=useState(''),[phone,setPhone]=useState('');
 const [busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [confirm,setConfirm]=useState<NumberControl|null>(null);
 const version=useRef(0),mutation=useRef(false);
 const load=useCallback(async()=>{
  const request=++version.current;
  try{const value=await api('chat-controls?search='+encodeURIComponent(search));if(request===version.current&&!mutation.current){setState(value);setError('');}}
  catch(e){if(request===version.current)setError((e as Error).message);}
 },[api,search]);
 useEffect(()=>{const timer=setTimeout(()=>void load(),250);return()=>{clearTimeout(timer);version.current++;}},[load]);
 async function change(number:string,stopped:boolean){
  if(mutation.current)return;mutation.current=true;version.current++;setBusy(number);setError('');setNotice('');
  try{
   const result=await api('chat-controls',{phone:number,stopped},'PUT');
   setConfirm(null);setPhone('');
   setNotice(result.stopped?`+${result.phone} is stopped. New messages are ignored by the app.`:`+${result.phone} is allowed. Only new messages can be handled.`);
   mutation.current=false;await load();
  }catch(e){setError((e as Error).message);}finally{mutation.current=false;setBusy('');}
 }
 return <section className="clinic-chat-controls"><h2>Chat privacy</h2><p>Stop the app from handling a phone number across this clinic’s WhatsApp accounts. No chat content is shown here.</p>
 <div className="chat-privacy-note"><strong>Stopped means ignored</strong><p>New messages are not saved, sent to AI or answered. The app also skips read receipts and typing. You can still use WhatsApp on your phone.</p></div>
 <form className="chat-stop-form" onSubmit={e=>{e.preventDefault();setError('');setConfirm({phone,stopped:false});}}><label className="field">Stop a phone number<input type="tel" autoComplete="off" placeholder="+923001234567" required maxLength={32} value={phone} disabled={!!busy} onChange={e=>setPhone(e.target.value)}/><small>Include the country code. You can stop a number before it messages you.</small></label><button className="btn primary" disabled={!!busy}>Stop number</button></form>
 {confirm&&<div className="confirm-box" role="alert"><strong>{confirm.stopped?'Allow this number again?':'Stop this number?'}</strong><p>{confirm.phone.startsWith('+')?confirm.phone:'+'+confirm.phone}</p><p>{confirm.stopped?'Only future messages will be handled. Messages ignored while stopped are not recovered.':'This applies once the change is confirmed. Processing already started must finish first; queued replies will be discarded. Existing saved history is kept.'}</p><div className="actions"><button className="btn primary" disabled={!!busy} onClick={()=>void change(confirm.phone,!confirm.stopped)}>{busy?'Saving…':confirm.stopped?'Allow number':'Confirm stop'}</button><button className="btn" disabled={!!busy} onClick={()=>setConfirm(null)}>Cancel</button></div></div>}
 {busy&&<p role="status">Applying privacy settings. Please wait for confirmation.</p>}{error&&<div className="alert" role="alert">{error}</div>}{notice&&<div className="toast" role="status">{notice}</div>}
 <button className="text-button" disabled={!!busy} onClick={()=>void load()}>Refresh numbers</button><label className="field chat-number-search">Find a phone number<input type="search" disabled={!!busy} inputMode="tel" autoComplete="off" value={search} maxLength={30} placeholder="Search by number" onChange={e=>setSearch(e.target.value.replace(/[^+0-9 ()-]/g,''))}/></label>
 {!state&&!error&&<p role="status">Loading phone numbers…</p>}<ul className="chat-number-list" aria-label="Phone number privacy controls">{state?.numbers.map(n=><li key={n.phone}><div><strong>+{n.phone}</strong><span className={n.stopped?'chat-stopped':''}>{n.stopped?'Stopped · messages ignored':'Allowed · follows clinic reply settings'}</span></div><button className="btn" disabled={!!busy} onClick={()=>setConfirm(n)}>{n.stopped?'Allow number':'Stop'}</button></li>)}</ul>
 {state&&!state.numbers.length&&<p>No matching numbers. Add a number above to stop it.</p>}{state?.hasMore&&<p>Showing the first 100 matches. Search for a specific number.</p>}
 <p className="status-footnote">This setting is separate from Online / Offline and stays in place until you allow the number again. WhatsApp may still receive messages on your devices. If WhatsApp hides a sender’s phone number and it cannot be matched safely, the app ignores that unknown sender while any privacy stops are active.</p></section>;
}
