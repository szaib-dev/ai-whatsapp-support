"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {Clock3,Play,RefreshCw,Search,UserRound,ShieldOff,ArrowUpRight,Check,SlidersHorizontal} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Skeleton} from '@/components/ui/skeleton';
import {Tabs,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {ConfirmDialog} from '../ui/primitives';
type Chat={id:string|null;name:string|null;account_number?:string|null;phone:string|null;state:'active'|'human'|'timed'|'stopped';pause_until:string|null;privacy_stopped:boolean;contact_restricted:boolean};
const labels={active:'Assistant on',human:'Human handover',timed:'Paused',stopped:'Stopped'};
export default function ClinicAssistantControls({api,onPrivacy}:{api:(path:string,body?:unknown,method?:string)=>Promise<any>;onPrivacy:()=>void}){
 const [rows,setRows]=useState<Chat[]>([]),[search,setSearch]=useState(''),[filter,setFilter]=useState('timed'),[loading,setLoading]=useState(true),[hasMore,setHasMore]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirm,setConfirm]=useState<Chat|null>(null),[now,setNow]=useState(Date.now());
 const generation=useRef(0),mutating=useRef(false);
 const load=useCallback(async(offset=0)=>{if(mutating.current)return;const v=++generation.current;setLoading(true);try{const d=await api('chat-assistant?search='+encodeURIComponent(search)+'&filter='+filter+'&offset='+offset);if(v===generation.current){setRows(old=>offset?[...old,...d.chats]:d.chats);setHasMore(d.hasMore);setError('');setNow(Date.now())}}catch(e){if(v===generation.current)setError((e as Error).message)}finally{if(v===generation.current)setLoading(false)}},[api,search,filter]);
 useEffect(()=>{const timer=setTimeout(()=>void load(),200),poll=setInterval(()=>void load(),10000);return()=>{clearTimeout(timer);clearInterval(poll);generation.current++}},[load]);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[]);
 async function resume(){if(!confirm||mutating.current)return;mutating.current=true;generation.current++;setBusy(true);setError('');try{if(confirm.id)await api('chat-assistant/'+confirm.id+'/resume',confirm.privacy_stopped?{unstop:true}:{});else if(confirm.phone)await api('chat-controls',{phone:confirm.phone,stopped:false},'PUT');else throw Error('Waiting for WhatsApp to verify this contact’s number.');setConfirm(null);toast.success(confirm.state==='stopped'?'Contact unstopped. Only new messages will be handled.':'Assistant resumed. Only new messages will be handled.');mutating.current=false;await load()}catch(e){setError((e as Error).message);toast.error((e as Error).message)}finally{mutating.current=false;setBusy(false)}}
 return <section className="assistant-controls">
  <header className="assistant-controls-heading"><span className="section-index">CONVERSATION SETTINGS</span><h2>Keep the right chats moving.</h2><p>Resume your assistant whenever you’re ready.</p></header>
  <div className="assistant-controls-toolbar"><Tabs value={filter} onValueChange={setFilter}><TabsList><TabsTrigger value="timed">30-min paused</TabsTrigger><TabsTrigger value="human">Human handover</TabsTrigger><TabsTrigger value="stopped">Stopped</TabsTrigger></TabsList></Tabs><div className="assistant-controls-search"><Search size={16}/><Input aria-label="Search assistant chats" placeholder="Find a contact" value={search} onChange={e=>setSearch(e.target.value)}/></div><Button variant="ghost" size="icon" aria-label="Refresh assistant statuses" disabled={loading||busy} onClick={()=>void load()}><RefreshCw size={16}/></Button></div>
  {error&&<p className="form-error" role="alert">{error}</p>}
  <div className="assistant-controls-list">{loading&&!rows.length?<Skeleton className="h-32"/>:rows.map(c=>{
   const expires=c.pause_until?new Date(c.pause_until):null,state=c.state==='timed'&&expires&&expires.getTime()<=now?'active':c.state;
   const label=c.name||(c.phone?'+'+c.phone:'Contact details unavailable');
   return <article className="assistant-chat" key={c.id||'phone:'+c.phone}>
    <span className={'assistant-chat-avatar '+state}>{state==='timed'?<Clock3 size={18}/>:state==='stopped'?<ShieldOff size={18}/>:state==='active'?<Check size={18}/>:<UserRound size={18}/>}</span>
    <div className="assistant-chat-person"><strong>{label}</strong>{!c.name&&!c.phone&&<small>Waiting for WhatsApp contact sync</small>}</div>
    <div className="assistant-chat-status"><span className={'assistant-state '+state}><i/>{c.privacy_stopped&&!c.phone?'Number unverified':labels[state]}</span>{state==='timed'&&expires&&<small>{Math.max(1,Math.ceil((expires.getTime()-now)/60000))} min left · until {expires.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</small>}{c.privacy_stopped&&<small>{c.phone?'New messages are blocked':'Privacy protection is waiting for a verified number'}</small>}</div>
    <div className="assistant-chat-action">{c.privacy_stopped&&!c.phone?<span className="assistant-chat-sync">Contact sync needed</span>:state!=='active'?<Button variant="outline" size="sm" disabled={busy} aria-label={(state==='stopped'?'Unstop ':'Resume assistant for ')+label} onClick={()=>{setError('');setConfirm(c)}}><Play size={14}/>{state==='stopped'?'Unstop':'Resume'}</Button>:<span className="assistant-chat-ready">Ready for new messages</span>}</div>
   </article>;
  })}</div>
  {!loading&&!rows.length&&<div className="assistant-controls-empty"><span><SlidersHorizontal size={23}/></span><h3>{search?'No matching chats':'No '+(filter==='timed'?'30-minute pauses':filter==='human'?'human handovers':'stopped contacts')}</h3><p>{search?'Try another name or phone number.':'Contacts appear here when this control applies.'}</p></div>}
  {hasMore&&<Button variant="outline" loading={loading} onClick={()=>void load(rows.length)}>Load more</Button>}
  <footer className="assistant-controls-footer"><p>Resume handles new messages only. Workspace availability still applies.</p><Button variant="link" size="sm" onClick={onPrivacy}>Manage chat privacy<ArrowUpRight size={13}/></Button></footer>
  <ConfirmDialog open={!!confirm} title={confirm?.state==='stopped'?'Unstop this contact?':'Resume assistant?'} description={(confirm?.privacy_stopped?'Allow this number across this workspace’s WhatsApp accounts. The assistant can handle new messages from ':'The assistant can reply to new messages from ')+(confirm?.name||(confirm?.phone?'+'+confirm.phone:'this contact'))+'. Any handover or pause timer will end.'+(confirm?.contact_restricted?' Contact reply permissions will return to normal; custom instructions are kept.':'')} busy={busy} onCancel={()=>{setConfirm(null);setError('')}} onConfirm={()=>void resume()} confirmLabel={confirm?.state==='stopped'?'Unstop contact':'Resume assistant'}>{error&&<p className="form-error" role="alert">{error}</p>}</ConfirmDialog>
 </section>;
}
