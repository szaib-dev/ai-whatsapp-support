"use client";
import {cachedConnections,loadConnections,invalidateConnections} from './live-updates';
import { Icon } from "./icons";
import { useCallback, useEffect, useRef, useState } from "react";
type Account = { id: string; status: string; authenticated_jid: string | null; qr: string | null;owner_availability?:string;owner_status_at?:string };
export default function WhatsAppPanel({ org, token }: { org: string; token: string }) {
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
      if(!path&&method==="GET")return await loadConnections(org,token,signal);
      const r = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(r.status === 403 ? "Your session or owner permissions could not be verified. Please sign in again." : "The server is temporarily unavailable. Retrying automatically.");
      return await r.json();
    } catch (e) {
      if (signal?.aborted) throw e;
      if (e instanceof TypeError || (e as Error).name === "TimeoutError") throw new Error("Cannot reach the server. Retrying automatically; your account is saved.");
      throw e;
    }
  }, [base, token,org]);
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
      await request(path, "POST");
      const data = await request();
      if (mounted.current) { setAccounts(data.accounts); setEnabled(data.enabled);setOnlyWhenAway(!!data.onlyWhenAway); setOnline(true); }
    } catch (e) { if (mounted.current) setNotice((e as Error).message); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function availability(mode:boolean,accountId?:string,value?:string){
    if(busy)return;setBusy(true);setNotice('');try{
      const response=await fetch(`${process.env.NEXT_PUBLIC_API_URL||'http://localhost:3101'}/organizations/${org}/owner-availability`,{method:'PATCH',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({onlyWhenAway:mode,accountId,availability:value}),signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error('Availability could not be saved. Please retry.');
      invalidateConnections(org,token);const data=await request();setAccounts(data.accounts);setOnlyWhenAway(data.onlyWhenAway);setNotice(value==='away'?'Away mode active. Unread, unanswered messages can now receive AI replies.':value==='online'?'Online mode selected. AI replies stay paused until you change it.':mode?'Away-only mode enabled. Set your status for each number.':'Always-on automatic replies restored.');
    }catch(e){setNotice((e as Error).message)}finally{setBusy(false)}
  }
  const [confirm,setConfirm]=useState<{id:string;action:string}|null>(null);
  const canAct = !busy && online && enabled;
  return <section className="card">
    <h2>WhatsApp numbers</h2>
    <p>On your phone, open WhatsApp → Linked devices → Link a device, then scan the code here.</p>
    <p className="muted">Automatic replies start after connection. Business details are optional. </p>
    <div className="owner-mode"><label className="toggle-row"><span><strong>Reply only when I’m away</strong><p>Hold new messages when you manually select Online. Exclude messages you have read or answered.</p></span><input type="checkbox" role="switch" checked={onlyWhenAway} disabled={busy} onChange={e=>void availability(e.target.checked)}/></label>{onlyWhenAway&&<p className="owner-help">This is a manual reply setting, not WhatsApp presence detection. Phone reads and replies do not change it. Select <strong>I’m away</strong> below when ready; your choice stays in effect until you or the clinic change it. Unknown status pauses replies. The bot does not mark waiting messages seen in this mode.</p>}</div>
    {loading ? <p role="status">Loading your connection…</p> : !online ? <p role="status">Server connection interrupted. Reconnecting…</p> : !enabled ? <p role="status">Recovering the WhatsApp connection service. This page will update automatically.</p> : null}
    {!accounts.length && !loading && <button disabled={!canAct} onClick={() => action("")}>Add WhatsApp account</button>}
    {accounts.map((a, index) => <article key={a.id} style={{ borderTop: "1px solid #e2e8e7", padding: "20px 0" }}>
      <p><strong>{a.authenticated_jid?.split("@")[0] || `WhatsApp account ${index + 1}`}</strong> · {!online ? "Status unavailable" : a.status === "awaiting_scan" ? "Scan the QR code" : a.status}</p>
      {onlyWhenAway&&<div className="owner-status"><span className="badge neutral">{a.owner_availability==='away'?'Away — unread messages eligible':a.owner_availability==='online'?'Online — AI paused':'Status unknown — AI paused'}</span><div className="actions"><button className={a.owner_availability==='online'?'btn primary':'btn'} disabled={busy} onClick={()=>void availability(true,a.id,'online')}>I’m online · pause AI</button><button className={a.owner_availability==='away'?'btn primary':'btn'} disabled={busy} onClick={()=>void availability(true,a.id,'away')}>I’m away · handle unread</button></div></div>}
      <div className="actions">
        <button disabled={!canAct || a.status === "connected"} onClick={() => action(`/${a.id}/connect`)}>{["connecting", "reconnecting", "awaiting_scan"].includes(a.status) ? "Refresh QR code" : "Connect"}</button>
        <button disabled={!canAct || a.status === "disconnected"} onClick={()=>setConfirm({id:a.id,action:'disconnect'})}>Disconnect WhatsApp</button>
        <button disabled={!canAct} onClick={()=>setConfirm({id:a.id,action:'unlink'})}>Unlink device</button>
        <button className="danger-button" disabled={!canAct} onClick={()=>setConfirm({id:a.id,action:'remove'})}><Icon name="trash" size={15}/>Delete from dashboard</button>
      </div>
      {online && a.qr ? <div><img src={a.qr} alt="Scan to link this clinic’s WhatsApp account" width={280} height={280} /><p>Keep this page open. Codes refresh automatically.</p></div> : online && ["connecting", "reconnecting", "awaiting_scan"].includes(a.status) ? <p role="status">Waiting for a fresh QR code… Use Refresh QR code if it does not appear.</p> : null}
      {online && a.status === "connected" && <p>{onlyWhenAway?'Connected. AI waits until you select I’m away, and skips messages you have read or answered.':'Connected. Automatic replies are available. You can pause individual conversations.'}</p>}
    </article>)}
    {accounts.length > 0 && <details><summary>Connect another number</summary><button disabled={!canAct} onClick={() => action("")}>Add another WhatsApp account</button></details>}
    {confirm&&<div className="confirm-box" role="alert"><strong>{confirm.action==='disconnect'?'Disconnect this WhatsApp number?':confirm.action==='remove'?'Remove this WhatsApp account?':'Unlink this device?'}</strong><p>{confirm.action==='disconnect'?'Automatic replies and automatic reconnection will stop. Your saved link and chat history are kept.':'Saved pairing credentials will be removed and automatic replies will stop.'} {confirm.action==='disconnect'?'You can reconnect here whenever you are ready.':confirm.action==='remove'?'The account will disappear from this list. Chat history is kept.':'To use it again you will need to scan a new QR code. Also check Linked devices on your phone.'}</p><div className="actions"><button className="danger-button" disabled={busy} onClick={async()=>{await action(`/${confirm.id}/${confirm.action}`);setConfirm(null)}}>Confirm {confirm.action==='remove'?'removal':'unlink'}</button><button onClick={()=>setConfirm(null)}>Cancel</button></div></div>}
    {notice && <p role="alert">{notice}</p>}
  </section>;
}
