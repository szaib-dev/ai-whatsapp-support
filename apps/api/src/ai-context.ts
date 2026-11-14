import type {Context} from './ai.js';
// Fail closed: summaries, staff text, legacy generated text and Calendar output
// have no authority to become external model context.
export function externalAiContext(c:Context):Context{
 const history=c.history.filter(m=>! /\b(?:CONFIRM|CANCEL)\s+[A-F\d]{6}\b/i.test(m.content)&&m.organization_id===c.organization_id&&m.conversation_id===c.conversation.id&&((m.sender==='customer'&&m.ai_context_source==='user')||(m.sender==='ai'&&m.ai_context_source==='assistant')));
 const memories=c.memories.filter(m=>m.organization_id===c.organization_id&&m.contact_id===c.contact.id&&m.kind==='preferred_name'&&m.ai_context_source==='user');
 return {...c,history:history.map(m=>({...m,content:externalCustomerText(m.content,c)})),memories:memories.map(m=>({...m,content:externalCustomerText(m.content,c)}))};
}
export function customerBookingMessages(c:Context){return externalAiContext(c).history.filter(m=>m.sender==='customer'&&!/\b(?:CONFIRM|CANCEL)\s+[A-F\d]{6}\b/i.test(m.content));}

export function externalCustomerText(text:string,c?:Context){for(const m of c?.history||[]){if((m.ai_context_source==='calendar'||(m.sender!=='customer'&&m.ai_context_source!=='assistant'))&&m.content.length>=16)text=text.replaceAll(m.content,'[private booking response omitted]');}return text.replace(/\b(?:CONFIRM|CANCEL)\s+[A-F\d]{6}\b/gi,'[booking confirmation handled privately]');}
