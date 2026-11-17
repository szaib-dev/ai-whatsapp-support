import 'dotenv/config';
import {randomUUID} from 'node:crypto';
import {DeepSeek} from '../dist/ai.js';
import {processAssistantTurn} from '../dist/conversation-engine.js';
import {defaultKnowledge} from '../dist/knowledge.js';
import {legacyDocuments,defaultSettings} from '../dist/agent-config.js';
// Synthetic conversations only. No database, transport, notification or booking adapter.
const org=randomUUID(),chat=randomUUID(),contact=randomUUID(),account=randomUUID();
const knowledge={...defaultKnowledge(),businessName:'Avery Studio',instructions:'Be relaxed and concise, like a thoughtful personal assistant. Use the sender’s current language. The owner is Avery. When introducing yourself, say you are Avery’s assistant and explain Avery is unavailable when the manual availability setting is away.',description:'Website design and accessibility consulting. Approved website design price starts at $200.'};
const context={organization_id:org,account:{id:account,organization_id:org,session_id:'synthetic',authenticated_jid:'synthetic@s.whatsapp.net',status:'connected',owner_availability:'away'},contact:{id:contact,organization_id:org,identity:'synthetic@lid',ai_opt_out:false},conversation:{id:chat,organization_id:org,account_id:account,contact_id:contact,mode:'active'},revision:{id:randomUUID(),organization_id:org,content:knowledge},memories:[],history:[],agent:{organization_id:org,documents:legacyDocuments(org,knowledge),settings:defaultSettings}};
const cases=[
 {message:'Hi, are you available?',action:'REPLY'},
 {message:'My name is Taylor. I need a website for a bakery.',action:'REPLY'},
 {message:'Which business did I say the website was for?',action:'REPLY',contains:/bakery/i},
 {message:'🙄🙄🙄',action:'IGNORE'},
 {message:'Thanks, that is all. Bye',action:'IGNORE'},
 {reset:true,message:'Salam, mujhe aik website banwani hai.',action:'REPLY'},
 {message:'Please explain your website services in English.',action:'REPLY',contains:/website|design|accessibility/i},
 {reset:true,message:'Tusi Punjabi vich gal kar sakde o? Mainu apni dukaan layi website chahidi ae.',action:'REPLY'},
 {reset:true,message:'The payment page still does not load. I want to speak directly with Avery, please take me out of automated replies.',action:'HANDOVER'},
 {message:'Great, exactly what I needed, another broken page 🙄',action:'IGNORE'},
 {reset:true,message:'It is urgent. Ask Avery to call me personally.',action:'HANDOVER'},
 {reset:true,message:'Are you actually AI or a real person?',action:'REPLY',contains:/AI|artificial|automated|virtual|language model/i},
 {message:'Hey',action:'REPLY',afterHours:12},
 {message:'🙄🙄',action:'IGNORE'},
 {reset:true,message:'Avery ko online bulao, unse khud baat karni hai.',action:'HANDOVER'},
 {reset:true,message:'Main Avery naal sidhi gal karni ae, tusi jawab na deo.',action:'HANDOVER'}
];
let failures=0;
for(const [i,test] of cases.entries()){
 if(test.reset){context.history=[];context.conversation.mode='active';}
 if(test.afterHours)context.history=context.history.map(m=>({...m,created_at:new Date(Date.now()-test.afterHours*3600000).toISOString()}));
 context.currentMessageAt=new Date().toISOString();
 const result=await processAssistantTurn(context,test.message,new DeepSeek(),{dryRun:true});
 if(result.handoff)context.conversation.mode='human';
 const pass=result.actions?.includes(test.action)&&(!test.contains||test.contains.test(result.reply))&&(test.action!=='IGNORE'||result.reply==='');if(!pass)failures++;
 console.log(JSON.stringify({case:i+1,pass,expected:test.action,actions:result.actions,reply:result.reply,usage:result.diagnostics?.usage,...(pass?{}:{diagnostics:result.diagnostics}),documents:result.diagnostics?.documents?.map(d=>d.name)}));
 context.history.push({organization_id:org,conversation_id:chat,sender:'customer',content:test.message,ai_context_source:'user',created_at:context.currentMessageAt});
 if(result.actions?.includes('REPLY'))context.history.push({organization_id:org,conversation_id:chat,sender:'ai',content:result.reply,ai_context_source:'assistant',created_at:new Date().toISOString()});
}
console.log(JSON.stringify({cases:cases.length,failures}));process.exitCode=failures?1:0;
