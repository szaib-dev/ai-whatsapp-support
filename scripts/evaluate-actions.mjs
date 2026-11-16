// Optional live-provider smoke test. Sends synthetic conversations only; never reads customer records.
import 'dotenv/config';
import {DeepSeek} from '../dist/ai.js';
import {defaultKnowledge} from '../dist/knowledge.js';
const org='00000000-0000-4000-8000-000000000001',chat='00000000-0000-4000-8000-000000000002';
const context={organization_id:org,contact:{organization_id:org,id:'contact',identity:'synthetic@lid',ai_opt_out:false},conversation:{organization_id:org,id:chat,mode:'active'},memories:[],history:[],revision:{organization_id:org,id:'revision',content:{...defaultKnowledge(),businessName:'Codetic',description:'We discuss and build websites and business software.',instructions:'The owner is Shahzaib. Match the customer’s language. Be concise.'}}};
const cases=[
 ['Hi, are you available?',['REPLY']],['🙄🙄🙄',['IGNORE']],['Bye',['IGNORE']],
 ['Shahzaib ko online bulao',['HANDOVER','NOTIFY_OWNER']],['It’s urgent, call me',['HANDOVER','NOTIFY_OWNER']],
 ['I want to discuss a new project',['REPLY']],['مالک سے بات کرنی ہے',['HANDOVER','NOTIFY_OWNER']],
 ['Shahzaib naal gal karni ae, ohnu bula deo',['HANDOVER','NOTIFY_OWNER']],
 ['heyy got a new projct can we tlk?',['REPLY']],
 ['مجھے نئی ویب سائٹ بنوانی ہے',['REPLY']],
 ['menu navi website banwani ae, ki madad kar sakde o?',['REPLY']],
 ['Great, the project form failed again 🙄',['REPLY']],
];
let failed=0;
for(let i=0;i<cases.length;i+=2)await Promise.all(cases.slice(i,i+2).map(async([text,expected])=>{
 try{const result=await new DeepSeek().decide(context,text);const pass=expected.every(action=>result.actions?.includes(action));if(!pass)failed++;
 console.log(JSON.stringify({message:text,actions:result.actions,pass}));}catch(e){failed++;console.log(JSON.stringify({message:text,error:e.name,issues:e.issues,pass:false}));}
}));
process.exitCode=failed?1:0;
