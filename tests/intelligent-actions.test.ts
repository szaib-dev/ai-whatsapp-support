import {it,expect,vi} from 'vitest';
import {automaticResponse,structuredDecision,providerDecision,conversationPrompt,type Context} from '../apps/api/src/ai.js';
import {validPushEndpoint,notificationPayload} from '../apps/api/src/notifications.js';
const context={organization_id:'workspace',contact:{id:'person',organization_id:'workspace',identity:'customer@lid',ai_opt_out:false,assistant_instructions:'Speak respectfully to this contact.'},conversation:{id:'chat',organization_id:'workspace'},memories:[],history:[],revision:{content:{businessName:'Codetic',description:'Web development',instructions:'The owner is Shahzaib.',facts:[],languages:['English']}}} as unknown as Context;
it.each(['🙄🙄🙄','Bye','Thanks, that’s all'])('honours contextual silence without retrying or sending a fallback: %s',async text=>{
 const decide=vi.fn(async()=>structuredDecision({actions:['IGNORE'],reply:''}));
 const answer=await automaticResponse(context,text,{select:vi.fn(),decide});
 expect(answer.reply).toBe('');expect(answer.handoff).toBe(false);expect(decide).toHaveBeenCalledTimes(1);
});
it('preserves a natural handover acknowledgement and combined notification action',async()=>{
 const decision=structuredDecision({actions:['REPLY','HANDOVER'],reply:'I’ll let Shahzaib know.',reason:'Customer requests the owner',category:'owner'});
 const decide=vi.fn(async()=>decision);const result=await automaticResponse(context,'Shahzaib ko online bulao',{select:vi.fn(),decide});
 expect(result).toEqual(decision);expect(result.actions).toContain('NOTIFY_OWNER');
});
it('does not suppress meaningful emoji or sarcasm through keyword/emoji rules',async()=>{
 const c={...context,history:[{organization_id:'workspace',conversation_id:'chat',sender:'customer',content:'The payment link is broken',ai_context_source:'user'}]};
 const decide=vi.fn(async()=>structuredDecision({actions:['REPLY','NOTIFY_OWNER'],reply:'I’ll ask the team to check the payment link.',reason:'Payment issue',category:'handover'}));
 expect((await automaticResponse(c,'Great, still broken 🙄',{select:vi.fn(),decide})).reply).toContain('payment');
 const prompt=conversationPrompt(c,'Great, still broken 🙄');expect(prompt[0].content).toContain('Punjabi');expect(prompt[0].content.toLowerCase()).toContain('contact');expect(prompt[1].content).toContain('payment link');
});
it('rejects contradictory or malformed model actions',()=>{
 for(const value of [{actions:['REPLY'],reply:''},{actions:['IGNORE'],reply:'Bye!'},{actions:['REPLY','IGNORE'],reply:'Hi'},{actions:['REPLY','REPLY'],reply:'Hi'},{actions:['SEND_MONEY']}])expect(()=>structuredDecision(value)).toThrow();
});
it('fails safely to silence plus review when the decision provider is unavailable',async()=>{
 const answer=await automaticResponse(context,'Can we discuss a project?',{select:vi.fn(),decide:async()=>{throw Error('offline')}});
 expect(answer.actions).toEqual(['IGNORE','NOTIFY_OWNER']);expect(answer.reply).toBe('');
});
it('allows only known browser push service HTTPS endpoints',()=>{
 for(const endpoint of ['http://fcm.googleapis.com/a','https://fcm.googleapis.com.attacker.test/a','https://localhost/a','https://127.0.0.1/a','https://user@fcm.googleapis.com/a','https://fcm.googleapis.com:8443/a'])expect(validPushEndpoint(endpoint)).toBe(false);
 for(const endpoint of ['https://fcm.googleapis.com/wp/token','https://updates.push.services.mozilla.com/wpush/v2/token','https://web.push.apple.com/token'])expect(validPushEndpoint(endpoint)).toBe(true);
});
it('hides sensitive payload details by default and scopes deep links to the workspace',()=>{
 const event={id:'event',organization_id:'workspace',conversation_id:'chat',reason:'Urgent call',preview:'PRIVATE_PREVIEW',sender_name:'PRIVATE_NAME'};
 const hidden=notificationPayload(event,false,false);expect(JSON.stringify(hidden)).not.toContain('PRIVATE');expect(hidden.url).toContain('workspace=workspace');expect(hidden.url).toContain('conversation=chat');
 expect(notificationPayload(event,true,false)).toMatchObject({title:'PRIVATE_NAME',body:'Urgent call · PRIVATE_PREVIEW'});expect(JSON.stringify(notificationPayload(event,true,true))).not.toContain('PRIVATE');expect(notificationPayload(event,true,true).url).not.toContain('conversation=');
});

it('normalizes provider metadata and handover acknowledgement variations without inventing replies',()=>{
 expect(providerDecision({actions:['IGNORE'],reply:'',category:null,reason:null})).toMatchObject({reply:'',handoff:false,actions:['IGNORE']});
 expect(providerDecision({actions:['HANDOVER','NOTIFY_OWNER'],reply:'I will let Shahzaib know.',category:'owner'}).actions).toContain('REPLY');
 expect(providerDecision({actions:['IGNORE'],reply:'Unnecessary goodbye',category:null}).reply).toBe('');
});
