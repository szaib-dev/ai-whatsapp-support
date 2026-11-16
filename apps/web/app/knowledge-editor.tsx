"use client";
import {useState} from 'react';
import {Check,BookOpen} from 'lucide-react';
import {Button} from '@/components/ui/button';import {Input} from '@/components/ui/input';import {Textarea} from '@/components/ui/textarea';import {Switch} from '@/components/ui/switch';import {Disclosure,useUnsavedChanges} from './ui/primitives';
export type Fact={id:string;category:string;question:string;answer:string};
export type Config={businessName:string;description:string;instructions:string;languages:string[];tone:string;escalationRules:string;neverClaims:string;aiEnabled:boolean;facts:Fact[]};
export type Revision={id:string;content:Config;created_at:string};
export const emptyConfig:Config={businessName:'',description:'',instructions:'',languages:['English'],tone:'warm',escalationRules:'',neverClaims:'',aiEnabled:true,facts:[]};
export type Request=(path:string,body?:unknown,method?:string)=>Promise<any>;
const example=`Business facts:
- Opening and closing times:
- Open days and holidays:
- Address:
- Services and confirmed prices:

How to reply:
- Reply language: (write your preferred language here).
- Tone: (describe how the assistant should sound).
- Keep replies short and friendly.
- If the customer is rude, stay calm and ask how we can help.
- If information is missing, say so and offer staff help.
- Ask for the preferred date and time for an appointment request. Staff must confirm bookings.
- Reply to related message chunks together. Do not repeat the same question.

When to involve staff:
- If the customer asks for a person, offer staff assistance.`;
export default function KnowledgeEditor({org,initial,revisions,published,request,onNotice,onSaved}:{org:string;initial:Config;revisions:Revision[];published:string;request:Request;onNotice:(text:string)=>void;onSaved?:(row:Revision)=>void}){
 const [config,setConfig]=useState(initial),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false);
 useUnsavedChanges(!saved&&JSON.stringify(config)!==JSON.stringify(initial));
 function update(value:Partial<Config>){setConfig({...config,...value});setSaved(false)}
 async function save(){setBusy(true);try{if(!config.businessName.trim())throw Error('Enter the business name.');const row=await request(`/organizations/${org}/knowledge`,config);await request(`/organizations/${org}/publish`,{revisionId:row.id});setSaved(true);onSaved?.(row);onNotice('Rules saved and active for new replies.')}catch(e){onNotice((e as Error).message)}finally{setBusy(false)}}
 return <><div className="section-toolbar"><div><h3>Business facts & assistant rules</h3><p>Publish reviewed information and clear instructions.</p></div><Button loading={busy} onClick={()=>void save()}><Check size={16}/>{saved?'Saved & active':'Save & publish'}</Button></div>{!config.aiEnabled&&<div className="inline-notice">Automatic replies are disabled. Enable the switch and publish to allow replies.</div>}<div className="editor-columns"><section className="knowledge-document"><label className="field">Business name<Input value={config.businessName} maxLength={160} onChange={e=>update({businessName:e.target.value})}/></label><label className="field">Business facts & assistant rules<small>Use confirmed facts. Include language, tone, working days, services, prices and handover rules.</small><Textarea className="rules-editor" value={config.instructions} maxLength={12000} placeholder={example} onChange={e=>update({instructions:e.target.value})}/><small>{config.instructions.length.toLocaleString()} / 12,000 characters</small></label><Button variant="outline" disabled={!!config.instructions.trim()} onClick={()=>update({instructions:example})}>Use a rules outline</Button><Disclosure title="Example outline"><pre>{example}</pre></Disclosure></section><aside className="knowledge-controls"><label className="setting-switch"><span><strong>Automatic replies</strong><small>Published changes affect new messages.</small></span><Switch aria-label="Automatic replies" checked={config.aiEnabled} onCheckedChange={v=>update({aiEnabled:v})}/></label><label className="field">About the business<Textarea value={config.description} rows={5} maxLength={2000} onChange={e=>update({description:e.target.value})}/></label><div className="privacy-inline"><BookOpen size={17}/><p>{published?'A published configuration is active.':'Publish your rules to activate them.'} {revisions.length} previous saves retained.</p></div>{config.facts.length>0&&<Disclosure title={`${config.facts.length} reviewed answers`}>{config.facts.map(f=><div key={f.id} className="reviewed-answer"><strong>{f.question}</strong><p>{f.answer}</p></div>)}</Disclosure>}</aside></div></>;
}
