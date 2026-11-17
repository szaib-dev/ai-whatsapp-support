import {it,expect,vi,afterEach} from 'vitest';
import {randomUUID} from 'node:crypto';
import {automaticResponse,buildConversationContext,replyLanguage,DeepSeek,type Context} from '../apps/api/src/ai.js';
import {legacyDocuments,defaultSettings,estimateTokens} from '../apps/api/src/agent-config.js';
import {defaultKnowledge} from '../apps/api/src/knowledge.js';
import {processAssistantTurn} from '../apps/api/src/conversation-engine.js';
function context():Context{const org=randomUUID(),chat=randomUUID(),contact=randomUUID(),account=randomUUID();const k={...defaultKnowledge(),businessName:'Avery Studio',instructions:'Keep things relaxed. Prefer Roman Urdu by default.',description:'Website design and development'};return {organization_id:org,account:{id:account,organization_id:org,session_id:'test',authenticated_jid:'test@s.whatsapp.net',status:'connected',owner_availability:'away'},conversation:{id:chat,organization_id:org,account_id:account,contact_id:contact,mode:'active'},contact:{id:contact,organization_id:org,identity:'test@lid',ai_opt_out:false},revision:{id:randomUUID(),organization_id:org,content:k},memories:[],history:[],agent:{organization_id:org,documents:legacyDocuments(org,k),settings:{...defaultSettings}}};}
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks()});
it('reproduces the emoji fallback path and keeps intentional silence silent, with no retry or booking work',async()=>{
 const c=context(),decide=vi.fn(async()=>({actions:['IGNORE'] as const,reply:'',handoff:false})),appointments={reply:vi.fn()};
 const result=await processAssistantTurn(c,'🙄🙄🙄',{select:vi.fn(),decide:decide as any},{appointments:appointments as any});
 expect(result.reply).toBe('');expect(result.actions).toEqual(['IGNORE']);expect(decide).toHaveBeenCalledTimes(1);expect(appointments.reply).not.toHaveBeenCalled();
 const legacy=await automaticResponse(c,'🙄🙄🙄',{select:async()=>null});expect(legacy.reply).toBe('');
});
it('provider failures and invalid structured replies never send generic filler, including owner requests',async()=>{
 for(const text of ['🙄','Speak with the owner please','Hello']){const result=await automaticResponse(context(),text,{select:vi.fn(),decide:async()=>{throw Object.assign(Error('private error detail'),{code:'PROVIDER_PARSE'})}});expect(result.reply).toBe('');expect(result.actions).toEqual(['IGNORE','NOTIFY_OWNER']);}
});
it('clear current English overrides a legacy Roman Urdu default and prior language',()=>{
 const c=context();c.history=[{organization_id:c.organization_id,conversation_id:c.conversation.id,sender:'customer',content:'Mujhe website chahiye',ai_context_source:'user'}];
 expect(replyLanguage(c,'Can you explain your services in detail?')).toBe('English');expect(replyLanguage(c,'Aap kaise hain?')).toBe('Roman Urdu');
 expect(buildConversationContext(c,'Can you explain your services?').diagnostics.languageHint).toBe('English');
});
it('retrieves relevant knowledge, retains recent turns and separates global and customer memory',()=>{
 const c=context();c.agent!.documents.find(d=>d.name==='KNOWLEDGE.md')!.content='## Website design\nWebsite design starts at $200.\n\n## Catering\nUnrelated catering information.';
 c.agent!.documents.find(d=>d.name==='MEMORY.md')!.content='## Website preferences\nApproved website preference: accessible layouts.';
 c.history=[{organization_id:c.organization_id,conversation_id:c.conversation.id,sender:'customer',content:'I need a website for my shop.',ai_context_source:'user'},{organization_id:c.organization_id,conversation_id:c.conversation.id,sender:'ai',content:'What should the website do?',ai_context_source:'assistant'}];
 const built=buildConversationContext(c,'What does website design cost?'),payload=JSON.stringify(built.messages);
 for(const name of ['IDENTITY.md','SOUL.md','RULES.md','KNOWLEDGE.md','MEMORY.md'])expect(built.diagnostics.documents.map(d=>d.name)).toContain(name);
 expect(payload).toContain('my shop');expect(payload).toContain('$200');expect(payload).not.toContain('Unrelated catering');
 expect(JSON.parse(built.messages[1].content).customerMemory).toEqual([]);
});
it('bounds context for large multilingual documents and rejects foreign-workspace configuration',()=>{
 const c=context();c.agent!.settings.context_tokens=4096;for(const d of c.agent!.documents)d.content='منظور شدہ معلومات اور اصول '.repeat(900);
 c.history=Array.from({length:60},()=>({organization_id:c.organization_id,conversation_id:c.conversation.id,sender:'customer',content:'A lengthy message '.repeat(300),ai_context_source:'user'}));
 const result=buildConversationContext(c,'English message '.repeat(500));expect(result.diagnostics.documents.filter(d=>['IDENTITY.md','SOUL.md','RULES.md'].includes(d.name))).toHaveLength(3);
 expect(estimateTokens(JSON.stringify(result.messages))).toBeLessThanOrEqual(4096);expect(result.diagnostics.currentMessageTruncated).toBe(true);
 c.agent!.organization_id=randomUUID();expect(()=>buildConversationContext(c,'Hi')).toThrow('configuration mismatch');
});
it('uses identical generation for live and dry turns, while a dry run cannot execute booking capabilities',async()=>{
 const c=context(),decision={reply:'I will let Avery know.',handoff:true,actions:['REPLY','HANDOVER','NOTIFY_OWNER'] as any},decide=vi.fn(async()=>decision),appointments={reply:vi.fn()};
 const ai={select:vi.fn(),decide};const live=await processAssistantTurn(c,'Please ask Avery to call',ai,{appointments:appointments as any}),dry=await processAssistantTurn(c,'Please ask Avery to call',ai,{dryRun:true,appointments:appointments as any});
 expect(live.reply).toBe(dry.reply);expect(live.actions).toEqual(dry.actions);expect(appointments.reply).not.toHaveBeenCalled();expect(dry.diagnostics?.sideEffects).toBe('disabled');
});
it('reports actual provider token usage without logging private conversation text',async()=>{
 const c=context(),log=vi.spyOn(console,'info').mockImplementation(()=>{});vi.stubEnv('DEEPSEEK_API_KEY','test-only-key');vi.stubEnv('AI_INPUT_USD_PER_MILLION','1');vi.stubEnv('AI_OUTPUT_USD_PER_MILLION','2');
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({actions:['IGNORE'],reply:'',category:'handover',reason:''})}}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}})})));
 const result=await new DeepSeek().decide(c,'PRIVATE_CONVERSATION_CANARY 🙄');expect(result.diagnostics?.usage).toEqual({inputTokens:100,outputTokens:20,totalTokens:120});expect(result.diagnostics?.estimatedCostUSD).toBeCloseTo(.00014);
 expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_CONVERSATION_CANARY');expect(JSON.stringify(log.mock.calls)).not.toContain('test-only-key');
});
