import {automaticResponse,replyLanguage,type Context,type ResponseDecision,type Selector} from './ai.js';
import {explicitHandoff} from './conversation.js';
import type {AppointmentHandler} from './appointments.js';

/** Financial approvals and transfers are not available to the WhatsApp assistant.
 * Check customer intent across the active exchange so short follow-ups ("500",
 * "JazzCash") cannot turn an earlier request into a fake transfer promise.
 * Do not persist or echo the payment details in the acknowledgement. */
function financialHandoff(c:Context,text:string):ResponseDecision|null{
 const now=Date.parse(c.currentMessageAt||new Date().toISOString());
 const recent=c.history.filter(m=>m.sender==='customer').slice(-6)
  .filter(m=>!m.created_at||!Number.isFinite(Date.parse(String(m.created_at)))||Math.abs(now-Date.parse(String(m.created_at)))<=30*60*1000)
  .map(m=>m.content);
 const exchange=[...recent,text].join(' ');
 const account=/\b(?:jazz[\s-]*cash|easy[\s-]*paisa|easypaisa|bank|account|acc|iban|wallet)\b|جاز\s*کیش|ایزی\s*پیسہ|اکاؤنٹ|بینک/iu.test(exchange);
 const money=/\b(?:paisa|paise|pese|money|cash|rupee|rupees|rupay|rs|pkr)\b|پیسے|روپے|رقم/iu.test(exchange);
 const amount=/\b(?:rs\.?\s*|pkr\s*)?\d{2,7}\b/i.test(exchange);
 const transfer=/\b(?:send|sending|transfer|deposit|pay|refund|bhej\w*|bej\w*|bhij\w*)\b|بھیج|ٹرانسفر|جمع\s*کرا/iu.test(exchange);
 const borrowing=/\b(?:lend|borrow|udhar|qarz)\b|ادھار|قرض/iu.test(exchange);
 if(!(account&&(transfer||amount)||money&&transfer||borrowing))return null;
 const language=replyLanguage(c,text);
 const reply=language==='Urdu'
  ?'میں پیسے بھیج یا کسی ادائیگی کا وعدہ نہیں کر سکتا۔ یہ فیصلہ مالک خود کرے گا، میں انہیں بتا دیتا ہوں۔'
  :language==='Roman Urdu'
   ?'Main paise send nahi kar sakta. Owner ko bata deta hun, faisla woh khud karega.'
   :'I can’t send or promise money on the owner’s behalf. I’ll flag this for them to decide.';
 return {reply,handoff:true,actions:['REPLY','HANDOVER','NOTIFY_OWNER'],reason:'Financial approval or transfer requires the owner',category:'owner',diagnostics:{outcome:'financial_handoff'}};
}

/** Shared live/playground policy. Dry runs have no appointment adapter or delivery capabilities. */
export async function processAssistantTurn(c:Context,text:string,ai:Selector,options:{eventId?:string;appointments?:AppointmentHandler;dryRun?:boolean}={}):Promise<ResponseDecision & {calendar?:boolean}>{
 const behavior=c.contact.assistant_behavior||'normal';
 if(c.contact.ai_opt_out||behavior==='ignore'||!c.revision.content.aiEnabled)return {reply:'',handoff:false,actions:['IGNORE'],diagnostics:{outcome:'control_silence'}};
 if(c.conversation.mode!=='active')return {reply:'',handoff:false,actions:['IGNORE','NOTIFY_OWNER'],reason:'Conversation is under human control',category:'handover',diagnostics:{outcome:'human_control'}};
 if(behavior==='human')return {reply:'',handoff:true,actions:['IGNORE','HANDOVER','NOTIFY_OWNER'],reason:'Contact requires human assistance',category:'handover'};
 const financial=financialHandoff(c,text);if(financial)return financial;
 const control=/^(?:confirm|cancel)\b/i.test(text.trim());
 if(control&&!options.dryRun){const reply=await options.appointments?.reply(c,text,options.eventId||'')??null;if(reply!==null)return {reply,handoff:false,actions:['REPLY'],calendar:true};}
 let result=await automaticResponse(c,text,ai);
 if(!result.actions)result={...result,actions:[result.reply?'REPLY':'IGNORE',...(result.handoff?['HANDOVER','NOTIFY_OWNER'] as const:[])]};
 if(!options.dryRun&&!result.handoff&&result.actions?.includes('REPLY')&&!explicitHandoff(text)){
  const booking=await options.appointments?.reply(c,text,options.eventId||'')??null;
  if(booking!==null)result={...result,reply:booking,calendar:true} as typeof result;
 }
 if(behavior==='notify')result={...result,actions:[...new Set([...(result.actions||[result.reply?'REPLY':'IGNORE']),'NOTIFY_OWNER'] as const)],reason:result.reason||'Priority contact sent a message',category:result.category||'owner'};
 return {...result,diagnostics:{...result.diagnostics,...(options.dryRun?{dryRun:true,sideEffects:'disabled',appointmentExecution:'disabled'}:{})}};
}
