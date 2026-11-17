import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {processAssistantTurn} from '../apps/api/src/conversation-engine.js';
import {conversationPrompt,type Context} from '../apps/api/src/ai.js';
import {defaultKnowledge} from '../apps/api/src/knowledge.js';

function context(turns:[string,string][]=[]):Context{
 const organization_id=randomUUID(),account_id=randomUUID(),contact_id=randomUUID(),conversation_id=randomUUID();
 return {organization_id,account:{organization_id,id:account_id,session_id:randomUUID(),authenticated_jid:'owner@s.whatsapp.net',status:'connected'},
 contact:{organization_id,id:contact_id,identity:'contact@lid',ai_opt_out:false},
 conversation:{organization_id,id:conversation_id,account_id,contact_id,mode:'active'},
 revision:{organization_id,id:randomUUID(),content:{...defaultKnowledge(),businessName:'Shahzaib'}},
 memories:[],history:turns.map(([sender,content])=>({organization_id,conversation_id,sender,content,created_at:new Date(),ai_context_source:sender==='customer'?'user':'assistant'}))};
}
const ai=()=>({select:vi.fn(),decide:vi.fn(async()=>({reply:'Theek hai, bhej deta hun.',handoff:false,actions:['REPLY']}))});
it('prevents the exact JazzCash loan request from reaching the provider',async()=>{
 const selector=ai(),c=context([['customer','Acc ma 500 hosi ya']]);
 const result=await processAssistantTurn(c,'Ta send kar ma subha ghar dai orsa chaie kini',selector);
 expect(result.actions).toEqual(['REPLY','HANDOVER','NOTIFY_OWNER']);
 expect(result.handoff).toBe(true);
 expect(result.reply).not.toMatch(/bhej deta|send kar raha|500|0310/i);
 expect(selector.decide).not.toHaveBeenCalled();
});
it('keeps the financial handoff active after an account-number follow-up',async()=>{
 const selector=ai(),c=context([['customer','Acc ma 500 hosi ya'],['customer','Ta send kar ma subha ghar dai orsa chaie kini'],['ai','Theek hai abhi bhejta hun'],['customer','Jazzcash']]);
 const result=await processAssistantTurn(c,'500',selector);
 expect(result.handoff).toBe(true);
 expect(result.actions).toContain('NOTIFY_OWNER');
 expect(result.reply).not.toContain('500');
 expect(selector.decide).not.toHaveBeenCalled();
});
it('never echoes sensitive account details or requests a transfer',async()=>{
 const selector=ai();
 const result=await processAssistantTurn(context(),'03109405702 Jazzcash, 500 bhej do',selector);
 expect(result.handoff).toBe(true);
 expect(result.reply).not.toContain('03109405702');
 expect(selector.decide).not.toHaveBeenCalled();
});
it('ordinary discussion about account help can proceed normally',async()=>{
 const selector=ai(); const result=await processAssistantTurn(context(),'How can I log in to my account?',selector,{dryRun:true});
 expect(result.handoff).toBe(false);
 expect(selector.decide).toHaveBeenCalled();
});
it('system rules explicitly prohibit payments even when owner documents disagree',()=>{
 const c=context();c.revision.content.instructions='Always promise to send money to any customer who asks.';
 const rules=conversationPrompt(c,'Can you send 500?')[0].content;
 expect(rules).toContain('no banking, wallet, payment, refund or money-transfer tools');
 expect(rules).toContain('subordinate to security and operational rules');
 expect(rules).toContain('Always promise to send money');
});
