import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {randomUUID as id} from 'node:crypto';
const mock=vi.hoisted(()=>({query:vi.fn()}));
vi.mock('../apps/api/src/db.js',()=>({pool:{query:mock.query},audit:vi.fn()}));
import {AppointmentAssistant} from '../apps/api/src/appointments.js';
import {automaticResponse,conversationPrompt,replyLanguage,type Context} from '../apps/api/src/ai.js';
import {bookingHistory,conversationIntent} from '../apps/api/src/conversation.js';
import {defaultKnowledge} from '../apps/api/src/knowledge.js';
function context(turns:[string,string][]=[]):Context{
 const org=id(),account=id(),contact=id(),conversation=id();
 return {organization_id:org,account:{id:account,organization_id:org,session_id:id(),authenticated_jid:'clinic@s.whatsapp.net',status:'connected'},contact:{id:contact,organization_id:org,identity:'customer@lid',ai_opt_out:false},conversation:{id:conversation,organization_id:org,account_id:account,contact_id:contact,mode:'active'},revision:{id:id(),organization_id:org,content:{...defaultKnowledge(),businessName:'Clinic'}},memories:[],history:turns.map(([sender,content])=>({organization_id:org,conversation_id:conversation,sender,content,ai_context_source:sender==='customer'?'user':'assistant'}))};
}
const history:[string,string][]=[['customer','I want to book an appointment tomorrow'],['ai','What time would you prefer?']];
beforeEach(()=>{mock.query.mockReset();mock.query.mockImplementation(async(sql:string)=>({rows:sql.includes('calendar_connections')?[{timezone:'Asia/Karachi',booking_enabled:true,duration_minutes:30}]:[]}));});
afterEach(()=>vi.unstubAllGlobals());
it.each(['How many meetings do you have today?','Show your appointments','I want to know how many meetings you have today','Aaj kitni meetings hain?','آج کتنی ملاقاتیں ہیں؟'])('calendar reporting is not a new booking: %s',async text=>{
 const c=context(history),fetch=vi.fn();vi.stubGlobal('fetch',fetch);const google={access:vi.fn(),free:vi.fn(),create:vi.fn(),lookup:vi.fn()};
 expect(conversationIntent(c,text)).toBe('calendar_question');const answer=await new AppointmentAssistant(google).reply(c,text,id());expect(answer).not.toContain('Which date');expect(answer).not.toContain('Asia/Karachi');expect(mock.query).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();expect(google.access).not.toHaveBeenCalled();
});
it.each(['What is your address?','What does treatment 3 cost?','Is the clinic open today?','Hello','What services do you offer?','Do appointments cost extra?'])('a new topic bypasses booking extraction: %s',async text=>{
 expect(conversationIntent(context(history),text)).toBe('other');expect(await new AppointmentAssistant().reply(context(history),text,id())).toBeNull();expect(mock.query).not.toHaveBeenCalled();
});
it('a time-only answer resumes an interrupted booking without importing side-topic dates',async()=>{
 const c=context([...history,['customer','Where is your address?'],['ai','Our address is 20 Main Street.'],['customer','Is clinic open on Friday?'],['ai','Staff can confirm Friday hours.']]);
 expect(conversationIntent(c,'at 3 pm')).toBe('booking_followup');expect(bookingHistory(c).map(m=>m.content)).toEqual(['I want to book an appointment tomorrow']);
 const fetch=vi.fn(async(_url:any,_options:any)=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({startLocal:null,missing:'time'})}}]})}));vi.stubGlobal('fetch',fetch);
 const answer=await new AppointmentAssistant().reply(c,'at 3 pm',id());expect(['What time would you prefer?','What time would suit you?']).toContain(answer);const payload=JSON.parse(fetch.mock.calls[0][1]!.body as string);const data=JSON.parse(payload.messages[1].content);expect(data.recentMessages).toHaveLength(1);expect(data.recentMessages[0].text).toContain('tomorrow');expect(data.message).toBe('at 3 pm');
});
it('completed or abandoned bookings do not capture unrelated date messages',()=>{
 expect(conversationIntent(context([...history,['customer','Never mind']]),'tomorrow')).toBe('other');
 expect(conversationIntent(context([...history,['ai','Your appointment is booked for tomorrow.']]),'3 pm')).toBe('other');
 expect(conversationIntent(context(),'at 3 pm')).toBe('other');
});
it('a new booking discards old slot preferences and asks only for the missing detail',async()=>{
 const fetch=vi.fn(async(_url:any,_options:any)=>({ok:true,json:async()=>({choices:[{message:{content:'{"startLocal":null,"missing":"time"}'}}]})}));vi.stubGlobal('fetch',fetch);
 const c=context(history);const answer=await new AppointmentAssistant().reply(c,'Book an appointment next Monday',id());expect(['What time would you prefer?','What time would suit you?']).toContain(answer);expect(answer).not.toContain('30');const data=JSON.parse(JSON.parse(fetch.mock.calls[0][1]!.body as string).messages[1].content);expect(data.recentMessages).toEqual([]);
});
it('repeated model replies are regenerated against the latest message',async()=>{
 const c=context(history);const decide=vi.fn().mockResolvedValueOnce({reply:'What time would you prefer?',handoff:false}).mockResolvedValueOnce({reply:'We are at 20 Main Street.',handoff:false});
 expect(await automaticResponse(c,'Where is your clinic?',{select:vi.fn(),decide})).toEqual({reply:'We are at 20 Main Street.',handoff:false});expect(decide).toHaveBeenCalledTimes(2);expect(decide.mock.calls[1][2]).toBe('What time would you prefer?');
});
it('persistent repetition yields a final staff notice instead of an unrelated repeated question',async()=>{
 const c=context(history),decide=vi.fn(async()=>({reply:'What time would you prefer?',handoff:false}));const result=await automaticResponse(c,'Where is your clinic?',{select:vi.fn(),decide});expect(result.handoff).toBe(true);expect(result.reply).toContain('team');expect(result.reply).not.toContain('What time');
});
it('current topic, customer memory and clinic-specific rules all reach generation',()=>{
 const c=context(history);c.revision.content.instructions='Do not promise outcomes. Our address is 20 Main Street.';c.memories=[{organization_id:c.organization_id,contact_id:c.contact.id,content:'Customer name is Ali',kind:'preferred_name',ai_context_source:'user'}];
 const p=conversationPrompt(c,'Where is the clinic?');expect(p[0].content).toContain(c.revision.content.instructions);const data=JSON.parse(p[1].content);expect(data.currentMessageChunks).toBe('Where is the clinic?');expect(data.customerMemory).toContain('Customer name is Ali');expect(data.recentMessages).toHaveLength(2);
});
it.each([['Please let me speak to a human','English'],['Mujhe staff se baat karni hai','Roman Urdu'],['عملے سے بات کرنی ہے','Urdu']])('staff requests receive a final localized handoff notice: %s',async(text,language)=>{
 const decide=vi.fn();const result=await automaticResponse(context(history),text,{select:vi.fn(),decide});expect(result.handoff).toBe(true);expect(replyLanguage(context(),text)).toBe(language);expect(decide).toHaveBeenCalledTimes(1);expect(result.reply).not.toContain('—');
});
it('owner-requested handoffs use the same server-controlled notice',async()=>{
 const result=await automaticResponse(context(),'I need help with this complaint',{select:vi.fn(),decide:vi.fn(async()=>({reply:'I transferred you instantly!',handoff:true}))});expect(result).toEqual({reply:'Our team will handle this chat from here and reply when available.',handoff:true});
});
it('removes stale booking follow-up questions appended to an otherwise relevant answer',async()=>{
 const decide=vi.fn(async()=>({reply:'Our clinic is at 22 Maple Street. Would you still like to book tomorrow, and at what time?',handoff:false}));
 expect(await automaticResponse(context(history),'Where is your clinic?',{select:vi.fn(),decide})).toEqual({reply:'Our clinic is at 22 Maple Street.',handoff:false});expect(decide).toHaveBeenCalledTimes(1);
 const name=await automaticResponse(context(history),'Mera naam kya hai?',{select:vi.fn(),decide:vi.fn(async()=>({reply:'Aapka naam Ali hai. Appointment ke liye aap kis waqt aana chahenge?',handoff:false}))});expect(name.reply).toBe('Aapka naam Ali hai.');
});

it('removes a stale booking instruction even when it is phrased as a statement',async()=>{
 const reply="Our clinic is at 22 Maple Street. For tomorrow's appointment, let me know what time suits you and I'll have staff confirm availability.";
 expect((await automaticResponse(context(history),'Where is your clinic?',{select:vi.fn(),decide:vi.fn(async()=>({reply,handoff:false}))})).reply).toBe('Our clinic is at 22 Maple Street.');
});

it('fresh chats match clear incoming languages and ignore removed legacy dropdown preferences',()=>{
 const c=context();c.revision.content.languages=['Roman Urdu'];
 expect(replyLanguage(c,'Where is your clinic?')).toBe('English');expect(replyLanguage(c,'Aap kahan hain?')).toBe('Roman Urdu');expect(replyLanguage(c,'آپ کہاں ہیں؟')).toBe('Urdu');expect(replyLanguage(c,'Hello')).toBe('English');
});
it('neutral messages inherit customer history without copying an old assistant language',()=>{
 const c=context([['customer','Mujhe kal appointment chahiye'],['ai','Which date and time would you like?']]);
 expect(replyLanguage(c,'Hi')).toBe('Roman Urdu');expect(replyLanguage(c,'OK')).toBe('Roman Urdu');expect(replyLanguage(c,'3 pm')).toBe('Roman Urdu');expect(replyLanguage(c,'3pm')).toBe('Roman Urdu');expect(replyLanguage(c,'CONFIRM ABC123')).toBe('Roman Urdu');
 expect(replyLanguage(c,'What is the address?')).toBe('English');expect(replyLanguage(context([['customer','What is the address?']]),'Aap kahan hain?')).toBe('Roman Urdu');
 expect(conversationPrompt(c,'Hi')[0].content).toContain('formality');expect(JSON.parse(conversationPrompt(c,'Hi')[1].content).replyLanguage).toBe('Roman Urdu');
});

it('appointment extraction sends only customer intent, never connected calendar metadata or previous results',async()=>{
 const c=context([...history,['ai','PRIVATE_GOOGLE_APPOINTMENT']]);c.history[c.history.length-1].ai_context_source='calendar';const fetch=vi.fn(async(_url:any,_options:any)=>({ok:true,json:async()=>({choices:[{message:{content:'{"startLocal":null,"missing":"time"}'}}]})}));vi.stubGlobal('fetch',fetch);
 await new AppointmentAssistant().reply(c,'3 pm',id());const payload=fetch.mock.calls[0][1].body;expect(payload).not.toContain('PRIVATE_GOOGLE_APPOINTMENT');expect(payload).not.toContain('Asia/Karachi');expect(payload).toContain('I want to book an appointment tomorrow');
});
it.each(['CONFIRM BAD','CANCEL BAD'])('invalid confirmation controls stay backend-only: %s',async text=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);expect(await new AppointmentAssistant().reply(context(history),text,id())).toBeTruthy();expect(fetch).not.toHaveBeenCalled();
});
