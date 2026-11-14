"use client";
import {useState} from 'react';
import {Icon} from './icons';
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
 function update(value:Partial<Config>){setConfig({...config,...value});setSaved(false)}
 async function save(){setBusy(true);try{if(!config.businessName.trim())throw Error('Enter the business name.');const row=await request(`/organizations/${org}/knowledge`,config);await request(`/organizations/${org}/publish`,{revisionId:row.id});setSaved(true);onSaved?.(row);onNotice('Rules saved and active for new replies.')}catch(e){onNotice((e as Error).message)}finally{setBusy(false)}}
 return <><div className="section-toolbar"><div><h2>Business facts & assistant rules</h2><p>Write the facts and instructions your assistant should follow. Save once to make them active.</p></div><button className="btn primary" disabled={busy} onClick={save}><Icon name="check" size={16}/>{busy?'Saving…':saved?'Saved & active':'Save rules & activate'}</button></div>
 {!config.aiEnabled&&<div className="alert"><strong>Automatic replies are OFF.</strong><span>Enable the switch below before saving to start replies.</span></div>}
 <div className="editor-columns"><section className="panel"><label className="field">Business name<input value={config.businessName} maxLength={160} onChange={e=>update({businessName:e.target.value})}/></label><label className="field">Business facts & assistant rules<small>Include reply language, tone, hours, days, prices, location, rude-customer handling and when to ask staff. Only enter confirmed business information.</small><textarea className="rules-editor" maxLength={12000} value={config.instructions} onChange={e=>update({instructions:e.target.value})} placeholder={example}/><small>{config.instructions.length.toLocaleString()} / 12,000 characters</small></label><button className="btn" disabled={!!config.instructions.trim()} onClick={()=>update({instructions:example})}>Start with a rules outline</button><details className="rules-help"><summary>See an example outline</summary><pre>{example}</pre></details></section>
 <div><section className="panel"><h2>Reply controls</h2><label className="toggle-row"><span><strong>Automatic replies</strong><p>Enable your assistant for this business.</p></span><input type="checkbox" role="switch" checked={config.aiEnabled} onChange={e=>update({aiEnabled:e.target.checked})}/></label><p>Set the reply language and tone in your Business facts & assistant rules.</p></section>
 <section className="panel"><h2>Existing business details</h2><p>These details remain available to your assistant alongside your rules.</p><label className="field">About your business<textarea value={config.description} maxLength={2000} onChange={e=>update({description:e.target.value})}/></label>{config.facts.length>0&&<details className="rules-help"><summary>{config.facts.length} previously saved answers</summary>{config.facts.map(f=><p key={f.id}><strong>{f.question}</strong><br/>{f.answer}</p>)}</details>}<small>{published?'A saved configuration is active.':'Save your rules to activate them.'} {revisions.length} previous saves retained.</small></section></div></div></>;
}
