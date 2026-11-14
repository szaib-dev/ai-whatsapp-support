import {it,expect,vi,afterEach} from 'vitest';
import {DeepSeek,conversationPrompt,prompt,type Context} from '../apps/api/src/ai.js';
import {externalAiContext} from '../apps/api/src/ai-context.js';
import {bookingReply,type BookingState} from '../apps/api/src/booking-replies.js';
import {defaultKnowledge} from '../apps/api/src/knowledge.js';
const secret='CALENDAR_ONLY_CANARY_34c7';
function context():Context{return {organization_id:'clinic',conversation:{organization_id:'clinic',id:'chat',account_id:'account',contact_id:'person',mode:'active'},account:{organization_id:'clinic',id:'account',session_id:'session',status:'connected',authenticated_jid:'clinic@s.whatsapp.net'},contact:{organization_id:'clinic',id:'person',identity:'person@lid',ai_opt_out:false},revision:{organization_id:'clinic',id:'revision',content:{...defaultKnowledge(),businessName:'Clinic',description:'We open at 9am.'}},history:[{organization_id:'clinic',conversation_id:'chat',sender:'customer',ai_context_source:'user',content:'I want an appointment tomorrow'},{organization_id:'clinic',conversation_id:'chat',sender:'ai',ai_context_source:'calendar',content:secret},{organization_id:'clinic',conversation_id:'chat',sender:'ai',content:'LEGACY_PRIVATE_HISTORY'},{organization_id:'other',conversation_id:'other',sender:'customer',ai_context_source:'user',content:'OTHER_CLINIC_DATA'},{organization_id:'clinic',conversation_id:'chat',sender:'customer',ai_context_source:'user',content:'CONFIRM ABC123'}],memories:[{organization_id:'clinic',contact_id:'person',kind:'summary',ai_context_source:'user',content:secret},{organization_id:'clinic',contact_id:'person',kind:'preferred_name',ai_context_source:'calendar',content:secret},{organization_id:'clinic',contact_id:'person',kind:'preferred_name',ai_context_source:'user',content:'{"name":"Ali"}'}]};}
afterEach(()=>vi.unstubAllGlobals());
it('all prompt builders omit calendar, legacy, summary, confirmation and cross-clinic context',()=>{
 for(const messages of [conversationPrompt(context(),'Where are you?'),prompt(context(),'Hours?')]){const body=JSON.stringify(messages);for(const forbidden of [secret,'LEGACY_PRIVATE_HISTORY','OTHER_CLINIC_DATA','ABC123'])expect(body).not.toContain(forbidden);expect(body).toContain('Ali');expect(body).toContain('tomorrow');}
 expect(externalAiContext(context()).history).toHaveLength(1);
});
it('current forwarded calendar output and correction prompts cannot reintroduce protected text',()=>{
 const body=JSON.stringify(conversationPrompt(context(),'Please explain '+secret,secret));expect(body).not.toContain(secret);expect(body).toContain('omitted');
});
it('actual DeepSeek respond/select/basic requests share the privacy boundary',async()=>{
 const previous=process.env.DEEPSEEK_API_KEY;process.env.DEEPSEEK_API_KEY='synthetic-test-key';const bodies:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(_url:any,options:any)=>{bodies.push(options.body);const system=JSON.parse(options.body).messages[0].content;const content=system.startsWith('You select')?'{"factId":null}':system.startsWith('Classify')?'{"intent":"other"}':'{"reply":"We open at 9am.","handoff":false}';return {ok:true,json:async()=>({choices:[{message:{content}}]})};}));
 try{const ai=new DeepSeek();await ai.respond(context(),'Where are you?');await ai.select(context(),'Hours?');await ai.basic(context(),'Tell me something else');expect(bodies).toHaveLength(3);for(const body of bodies){expect(body).not.toContain(secret);expect(body).not.toContain('LEGACY_PRIVATE_HISTORY');expect(body).not.toContain('ABC123');}}finally{if(previous===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=previous;}
});
it.each(['English','Roman Urdu','Urdu'])('routine booking replies are localized, short and deterministic: %s',language=>{
 const states:BookingState[]=['available','alternative','unavailable','closed','date','time','unclear','confirmed','failed','uncertain','confirm','handoff','cancelled'];
 for(const state of states){const a=bookingReply(state,language,'event',{slot:'Monday 3 PM',code:'ABC123'});expect(a).toBe(bookingReply(state,language,'event',{slot:'Monday 3 PM',code:'ABC123'}));expect(a).not.toMatch(/Google|API|database|timezone|—/);if(language==='Urdu')expect(a).toMatch(/[\u0600-\u06ff]/);if(['available','alternative','confirm'].includes(state))expect(a).toContain('CONFIRM ABC123');}
 expect(new Set(Array.from({length:20},(_,i)=>bookingReply('time',language,String(i)))).size).toBeGreaterThan(1);
});
