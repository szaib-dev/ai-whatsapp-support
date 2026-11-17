import {it,expect,vi} from 'vitest';
import {Dispatcher,type InboxBatch} from '../apps/api/src/dispatcher.js';
import {explicitName} from '../apps/api/src/memory.js';
const batch=(key:string,texts:string[]):InboxBatch=>({ids:texts.map((_,i)=>key+i),key,session:'session',events:texts.map((text,i)=>({id:key+i,jid:key+'@lid',text}))});
it('combines ordered chunks into one reply request',async()=>{
 const finish=vi.fn(async()=>{}),deliver=vi.fn(async()=>{});let pending:InboxBatch|null=batch('a',['hi','my','name','is','Shahzaib']);
 const d=new Dispatcher({take:async()=>{const b=pending;pending=null;return b;},finish},deliver);
 await d.tick();await d.close();expect(deliver).toHaveBeenCalledTimes(1);const e=deliver.mock.calls[0] as unknown as [string,{text:string;parts:unknown[]}];expect(e[1].text).toBe('hi my name is Shahzaib');expect(e[1].parts).toHaveLength(5);expect(explicitName(e[1].text)).toBe('Shahzaib');expect(finish).toHaveBeenCalledWith(expect.any(Array),'done');
});
it('limits work to four customers and keeps a busy customer excluded',async()=>{
 const queue=Array.from({length:5},(_,i)=>batch(String(i),['hello']));const exclusions:string[][]=[];let release!:()=>void;const gate=new Promise<void>(r=>release=r);let running=0,peak=0;
 const d=new Dispatcher({take:async keys=>{exclusions.push([...keys]);return queue.shift()||null},finish:async()=>{}},async()=>{running++;peak=Math.max(peak,running);await gate;running--});
 await d.tick();expect(peak).toBe(4);expect(queue).toHaveLength(1);expect(exclusions[3]).toEqual(['0','1','2']);release();await d.close();expect(peak).toBe(4);
});
it('flags uncertain delivery and never automatically repeats it',async()=>{
 let pending:InboxBatch|null=batch('a',['hello']);const finish=vi.fn(async()=>{}),deliver=vi.fn(async()=>{throw Error('unknown send result')});const d=new Dispatcher({take:async()=>{const b=pending;pending=null;return b},finish},deliver);await d.tick();await d.close();expect(finish).toHaveBeenCalledWith(expect.any(Array),'uncertain');expect(deliver).toHaveBeenCalledTimes(1);
});
import {automaticAnswer,businessHours,conversationPrompt,replyLanguage,DeepSeek,type Context} from '../apps/api/src/ai.js';
it('recalls a name from recent customer history before selecting an unrelated approved answer',async()=>{
 const ai=new DeepSeek();ai.select=vi.fn(async()=>{throw Error('Name recall should not use fact selection')});const c={memories:[],history:[{sender:'customer',content:'My name is Shahzaib'}],revision:{content:{languages:['English'],facts:[{id:'identity',answer:'I am an assistant'}]}}} as unknown as Context;
 ai.decide=vi.fn(async()=>({reply:'Your name is Shahzaib.',handoff:false,actions:['REPLY'] as ['REPLY']}));expect(await automaticAnswer(c,'What was my name?',ai)).toContain('Shahzaib');expect(ai.select).not.toHaveBeenCalled();
});

it('uses explicit opening and closing times from the business description',async()=>{
 const description='This is a clinic. The Opening time is 11:30 am and closing time is 5:30 pm.';
 expect(businessHours(description)).toBe('Our opening hours are 11:30 am to 5:30 pm.');
 expect(businessHours('We are open, please visit')).toBeNull();
 const c={revision:{content:{description,facts:[]}},memories:[],history:[]} as unknown as Context;
 const select=vi.fn(async()=>null);expect(await automaticAnswer(c,'When does the clinic open?',{select})).toContain('11:30 am');expect(select).not.toHaveBeenCalled();
});

it('puts the owner rules, selected language and combined chunks in the conversational prompt',()=>{
 const c={revision:{content:{businessName:'Revive',languages:['Roman Urdu'],description:'Open 11:30 am to 5:30 pm',instructions:'Reply in Roman Urdu. If the customer is rude stay calm.',facts:[],tone:'warm'}},history:[],memories:[]} as unknown as Context;
 const messages=conversationPrompt(c,'Ok\nGotcha\nMan');expect(messages[0].content).toContain('Roman Urdu');expect(messages[0].content).toContain('stay calm');expect(messages[1].content).toContain('Gotcha');
 expect(replyLanguage(c,'Ok Gotcha Man')).toBe('English');
 expect(replyLanguage(c,'Hi')).toBe('English');
});
it('uses the generated reply instead of the old English templates',async()=>{
 const c={revision:{content:{languages:['Roman Urdu'],facts:[]}},history:[],memories:[]} as unknown as Context;
 const respond=vi.fn(async()=> 'Assalamualaikum! Kya madad chahiye?');
 expect(await automaticAnswer(c,'Hello',{select:async()=>null,respond})).toBe('Assalamualaikum! Kya madad chahiye?');expect(respond).toHaveBeenCalledTimes(1);
});
it('does not infer today availability from opening hours alone',async()=>{
 const c={revision:{content:{languages:['Roman Urdu'],description:'Opening time is 11:30 am and closing time is 5:30 pm.',instructions:'',facts:[]}},history:[],memories:[]} as unknown as Context;
 const respond=vi.fn(async()=> 'Open today');const reply=await automaticAnswer(c,'Is the clinic open today?',{select:async()=>null,respond});expect(reply).toContain('11:30 am');expect(reply).toContain('Please confirm');expect(respond).not.toHaveBeenCalled();
});

it('written language and tone rules override removed legacy preferences',async()=>{
 const c={revision:{content:{businessName:'Revive',languages:['Roman Urdu'],tone:'warm',instructions:'Reply in English. Use a professional tone.',description:'',facts:[]}},history:[],memories:[]} as unknown as Context;
 const content=conversationPrompt(c,'Hi')[0].content;expect(content).toContain('Reply in English');expect(content).not.toContain('Respond in Roman Urdu');expect(content).not.toContain('"tone":"warm"');
 expect(replyLanguage(c,'Hi')).toBe('English');
 c.revision.content.instructions='Always reply in Roman Urdu. Keep the tone friendly.';c.revision.content.languages=['English'];expect(replyLanguage(c,'Hi')).toBe('English');
});
