import {automaticResponse,type Context,type ResponseDecision,type Selector} from './ai.js';
import {explicitHandoff} from './conversation.js';
import type {AppointmentHandler} from './appointments.js';
/** Shared live/playground policy. Dry runs have no appointment adapter or delivery capabilities. */
export async function processAssistantTurn(c:Context,text:string,ai:Selector,options:{eventId?:string;appointments?:AppointmentHandler;dryRun?:boolean}={}):Promise<ResponseDecision & {calendar?:boolean}>{
 const behavior=c.contact.assistant_behavior||'normal';
 if(c.contact.ai_opt_out||behavior==='ignore'||!c.revision.content.aiEnabled)return {reply:'',handoff:false,actions:['IGNORE'],diagnostics:{outcome:'control_silence'}};
 if(c.conversation.mode!=='active')return {reply:'',handoff:false,actions:['IGNORE','NOTIFY_OWNER'],reason:'Conversation is under human control',category:'handover',diagnostics:{outcome:'human_control'}};
 if(behavior==='human')return {reply:'',handoff:true,actions:['IGNORE','HANDOVER','NOTIFY_OWNER'],reason:'Contact requires human assistance',category:'handover'};
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
