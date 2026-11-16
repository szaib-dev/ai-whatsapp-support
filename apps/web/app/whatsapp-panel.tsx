"use client";
import {cachedConnections,loadConnections,invalidateConnections} from './live-updates';
import {MessageCircle,Plus,MoreHorizontal,Plug,RefreshCw,Unplug,Trash2,Link2,ShieldCheck} from 'lucide-react';
import {Button} from '@/components/ui/button';import {Switch} from '@/components/ui/switch';import {Skeleton} from '@/components/ui/skeleton';import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem,DropdownMenuSeparator} from '@/components/ui/dropdown-menu';import {ConfirmDialog,FormDialog} from './ui/primitives';import {toast} from 'sonner';
import { useCallback, useEffect, useRef, useState } from "react";
type Account = { id: string; status: string; authenticated_jid: string | null; qr: string | null;owner_availability?:string;last_connected_at?:string;last_connection_error?:string;needs_pairing?:boolean;owner_status_at?:string };
export default function WhatsAppPanel({ org, token,requestClient }: { org: string; token: string;requestClient?:(path:string,body?:unknown,method?:string)=>Promise<any> }) {
  const [accounts, setAccounts] = useState<Account[]>(()=>cachedConnections(org,token)?.accounts||[]);
  const [onlyWhenAway,setOnlyWhenAway]=useState(!!cachedConnections(org,token)?.onlyWhenAway);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!cachedConnections(org,token));
  const [online, setOnline] = useState(!!cachedConnections(org,token));
  const [enabled, setEnabled] = useState(!!cachedConnections(org,token)?.enabled);
  const mounted = useRef(true);
  const base = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3101"}/organizations/${org}/whatsapp`;
  const request = useCallback(async (path = "", method = "GET", signal?: AbortSignal) => {
    try {
      if(requestClient)return requestClient(`/organizations/${org}/whatsapp`+path,undefined,method);
      if(!path&&method==="GET")return await loadConnections(org,token,signal);
      const r = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(r.status === 403 ? "Your session or owner permissions could not be verified. Please sign in again." : "The server is temporarily unavailable. Retrying automatically.");
      return await r.json();
    } catch (e) {
      if (signal?.aborted) throw e;
      if (e instanceof TypeError || (e as Error).name === "TimeoutError") throw new Error("Cannot reach the server. Retrying automatically; your account is saved.");
      throw e;
    }
  }, [base, token,org,requestClient]);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const data = await request("", "GET", controller.signal);
        if (!controller.signal.aborted) { setAccounts(data.accounts); setEnabled(data.enabled);setOnlyWhenAway(!!data.onlyWhenAway); setOnline(true); setNotice(""); }
      } catch (e) {
        if (!controller.signal.aborted) { setOnline(false); setNotice((e as Error).message); }
      } finally {
        if (!controller.signal.aborted) { setLoading(false); timer = setTimeout(refresh, 2000); }
      }
    }
    const changed=(event:Event)=>{if((event as CustomEvent).detail===org){clearTimeout(timer);void refresh();}};window.addEventListener('workspace-change',changed);
    void refresh();
    return () => { mounted.current = false;window.removeEventListener('workspace-change',changed); controller.abort(); clearTimeout(timer); };
  }, [request]);
  async function action(path: string) {
    if (busy) return;
    setBusy(true); setNotice("");
    try {
      const result=await request(path, "POST");
      if(!path&&result.id)await request(`/${result.id}/connect`,"POST");
      const data = await request();
      if (mounted.current) { setAccounts(data.accounts); setEnabled(data.enabled);setOnlyWhenAway(!!data.onlyWhenAway); setOnline(true); }
    } catch (e) { if (mounted.current){setNotice((e as Error).message);toast.error((e as Error).message);throw e;} }
    finally { if (mounted.current) setBusy(false); }
  }
  async function availability(mode:boolean,accountId?:string,value?:string){
    if(busy)return;setBusy(true);setNotice('');try{
      const response=requestClient?{ok:true}:await fetch(`${process.env.NEXT_PUBLIC_API_URL||'http://localhost:3101'}/organizations/${org}/owner-availability`,{method:'PATCH',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({onlyWhenAway:mode,accountId,availability:value}),signal:AbortSignal.timeout(15000)});
      if(requestClient)await requestClient(`/organizations/${org}/owner-availability`,{onlyWhenAway:mode,accountId,availability:value},'PATCH');
      if(!response.ok)throw Error('Availability could not be saved. Please retry.');
      invalidateConnections(org,token);const data=await request();setAccounts(data.accounts);setOnlyWhenAway(data.onlyWhenAway);setNotice(value==='away'?'Away mode active. Unread, unanswered messages can now receive AI replies.':value==='online'?'Online mode selected. AI replies stay paused until you change it.':mode?'Away-only mode enabled. Set your status for each number.':'Always-on automatic replies restored.');
    }catch(e){setNotice((e as Error).message)}finally{setBusy(false)}
  }
  const [add,setAdd]=useState(false);
  const [confirm,setConfirm]=useState<{id:string;action:string}|null>(null);
  const canAct = !busy && online && enabled;
  return <section className="connections-workspace"><div className="section-toolbar"><div><h3>WhatsApp connections</h3><p>Linked numbers and their current service state.</p></div><Button disabled={!canAct} onClick={()=>setAdd(true)}><Plus size={16}/>Connect number</Button></div>{!online&&<div className="inline-notice">Status is unknown while the API is unavailable. Retrying automatically.</div>}{online&&!enabled&&<div className="inline-notice">The connection worker is recovering. Existing pairing credentials are preserved.</div>}{notice&&<p className="form-error" role="status">{notice}</p>}<div className="connections-grid">{loading?<Skeleton className="h-48"/>:accounts.map((a,index)=>{const state=!online?'unknown':a.status==='disconnected'&&a.last_connection_error?'failed':a.status;const number=a.authenticated_jid&&/^[0-9]+@s\.whatsapp\.net$/.test(a.authenticated_jid)?'+'+a.authenticated_jid.split('@')[0]:`WhatsApp connection ${index+1}`;return <article className="integration-card" key={a.id}><div className="integration-card-head"><span className="integration-mark whatsapp-mark"><MessageCircle size={23}/></span><span className={'badge '+(state==='connected'?'green':'neutral')}>{state==='awaiting_scan'?'Scan QR code':state}</span><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={'Actions for '+number}><MoreHorizontal size={18}/></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={!canAct} onClick={()=>setConfirm({id:a.id,action:'disconnect'})}><Unplug/>Disconnect</DropdownMenuItem><DropdownMenuItem disabled={!canAct} onClick={()=>setConfirm({id:a.id,action:'unlink'})}><Link2/>Unlink device</DropdownMenuItem><DropdownMenuSeparator/><DropdownMenuItem variant="destructive" disabled={!canAct} onClick={()=>setConfirm({id:a.id,action:'remove'})}><Trash2/>Remove connection</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div><h3>{number}</h3><p>{state==='connected'?'Linked and ready. Assistant availability and contact rules apply.':state==='reconnecting'||state==='connecting'?'Reconnecting to WhatsApp. Your session is retained.':state==='unknown'?'The current connection state could not be verified.':a.last_connection_error||'Link a business phone to start handling messages.'}</p>{a.last_connected_at&&<small>Last connected {new Date(a.last_connected_at).toLocaleString()}</small>}{onlyWhenAway&&<div className="account-availability"><span>{a.owner_availability==='away'?'Offline · eligible unread messages':a.owner_availability==='online'?'Online · assistant paused':'Availability not selected'}</span><div><Button size="sm" variant={a.owner_availability==='online'?'secondary':'outline'} disabled={busy} onClick={()=>void availability(true,a.id,'online')}>Online</Button><Button size="sm" variant={a.owner_availability==='away'?'secondary':'outline'} disabled={busy} onClick={()=>void availability(true,a.id,'away')}>Offline</Button></div></div>}{online&&a.qr?<div className="connection-qr"><img src={a.qr} alt="Scan this QR code with your business WhatsApp" width={240} height={240}/><p>WhatsApp → Linked devices → Link a device.</p><small>Keep this screen open; the code refreshes automatically.</small></div>:state!=='connected'&&<Button variant="outline" loading={busy} disabled={!canAct} onClick={()=>void action(`/${a.id}/connect`).catch(()=>{})}><RefreshCw size={16}/>{['connecting','reconnecting','awaiting_scan'].includes(a.status)?'Refresh connection':'Connect / reconnect'}</Button>}</article>})}{!loading&&!accounts.length&&<div className="empty-state"><Plug size={30}/><h3>No linked WhatsApp numbers</h3><p>Create a connection, then scan the QR code with your phone.</p><Button disabled={!canAct} onClick={()=>setAdd(true)}><Plus size={16}/>Connect a number</Button></div>}</div><section className="settings-section"><ShieldCheck size={22}/><div><label className="setting-switch"><span><strong>Reply only when I’m away</strong><small>Manual Online pauses replies. Offline allows eligible unread messages.</small></span><Switch aria-label="Reply only when away" checked={onlyWhenAway} disabled={busy} onCheckedChange={v=>void availability(v)}/></label><p className="help-text">This is an assistant control, not WhatsApp presence detection. Reading or opening WhatsApp does not change the selection.</p></div></section><FormDialog open={add} onClose={()=>setAdd(false)} title="Connect a WhatsApp number" description="Your existing sessions and conversation history will stay intact." busy={busy}><p>Create a separate connection for this business. Then open WhatsApp on the business phone, select Linked devices and scan its QR code.</p><div className="dialog-actions"><Button variant="outline" disabled={busy} onClick={()=>setAdd(false)}>Cancel</Button><Button loading={busy} disabled={!canAct} onClick={()=>{void action('').then(()=>{setAdd(false);toast.success('Connection created. Scan the QR code to finish.');}).catch(()=>{})}}>Create connection</Button></div></FormDialog><ConfirmDialog open={!!confirm} title={confirm?.action==='disconnect'?'Disconnect WhatsApp?':confirm?.action==='unlink'?'Unlink this device?':'Remove this connection?'} description={confirm?.action==='disconnect'?'Automatic replies and reconnection stop. Pairing credentials and chat history are kept. You can reconnect later.':'Pairing credentials will be removed. Existing chat history stays in the workspace. You will need to scan a new QR code to reconnect.'} busy={busy} destructive confirmLabel={confirm?.action==='disconnect'?'Disconnect':confirm?.action==='unlink'?'Unlink device':'Remove connection'} onCancel={()=>setConfirm(null)} onConfirm={()=>{if(confirm)void action(`/${confirm.id}/${confirm.action}`).then(()=>{setConfirm(null);toast.success('Connection updated.');}).catch(()=>{})}}/></section>;
}
