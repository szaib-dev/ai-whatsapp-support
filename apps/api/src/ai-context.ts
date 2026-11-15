import type {Context} from './ai.js';
// Fail closed: summaries, staff text, legacy generated text and Calendar output
// have no authority to become external model context.
export function externalAiContext(c:Context):Context{
 const history=c.history.filter(m=>! /\b(?:CONFIRM|CANCEL)\s+[A-F\d]{6}\b/i.test(m.content)&&m.organization_id===c.organization_id&&m.conversation_id===c.conversation.id&&((m.sender==='customer'&&m.ai_context_source==='user')||(m.sender==='ai'&&m.ai_context_source==='assistant')));
 const memories=c.memories.filter(m=>m.organization_id===c.organization_id&&m.contact_id===c.contact.id&&m.kind==='preferred_name'&&m.ai_context_source==='user');
 return {...c,history:history.map(m=>({...m,content:externalCustomerText(m.content,c)})),memories:memories.map(m=>({...m,content:externalCustomerText(m.content,c)}))};
}
export function customerBookingMessages(c:Context){return externalAiContext(c).history.filter(m=>m.sender==='customer'&&!/\b(?:CONFIRM|CANCEL)\s+[A-F\d]{6}\b/i.test(m.content));}

export function externalCustomerText(text:string,c?:Context){
 const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const codes=new Set<string>();
 for(const m of c?.history||[]){
  for(const code of m.content.matchAll(/\b(?:CONFIRM|CANCEL)\s+([A-F\d]{6})\b/gi))codes.add(code[1].toUpperCase());
  const calendar=m.ai_context_source==='calendar';
  if(!calendar&&!(m.sender!=='customer'&&m.ai_context_source!=='assistant'))continue;
  // Forwarded text can add quote prefixes/line breaks. Match only known protected
  // content, leaving independently authored dates/preferences available to booking.
  const fragments=calendar?[m.content,...m.content.split(/\r?\n/)]:[m.content];
  for(const fragment of fragments){
   const value=fragment.trim();if(!value)continue;
   let pattern=value.split(/\s+/).map(escape).join('(?:\\s|>)+');
   if(value.length<16)pattern=`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`;
   text=text.replace(new RegExp(pattern,'giu'),'[private booking response omitted]');
  }
 }
 text=text.replace(/\b(?:CONFIRM|CANCEL)\s+[A-F\d]{6}\b/gi,'[booking confirmation handled privately]');
 // Known codes remain private when copied without their CONFIRM/CANCEL command.
 for(const code of codes)text=text.replace(new RegExp(`\\b${code}\\b`,'gi'),'[booking confirmation handled privately]');
 return text;
}
