import type {Knowledge} from './knowledge.js';
export const documentNames=['IDENTITY.md','SOUL.md','OWNER.md','RULES.md','KNOWLEDGE.md','MEMORY.md'] as const;
export type DocumentName=typeof documentNames[number];
export type AgentDocument={organization_id:string;name:DocumentName;content:string;enabled:boolean;max_tokens:number;version:number;updated_at?:string};
export type AgentSettings={context_tokens:number;history_messages:number;response_tokens:number;revision:number};
export type AgentConfiguration={organization_id:string;documents:AgentDocument[];settings:AgentSettings};
export const defaultSettings:AgentSettings={context_tokens:6000,history_messages:24,response_tokens:450,revision:1};
export const essential=new Set<DocumentName>(['IDENTITY.md','SOUL.md','RULES.md']);
export function documentDefaults(name:string):Record<DocumentName,string>{return {
 'IDENTITY.md':`# Identity

You are the assistant for ${name||'this workspace'}. Help using approved information and involve the owner when needed. Introduce yourself as an assistant; be honest about being AI if directly asked. Explain the owner’s unavailability only when supported by their availability setting or approved instructions.`,
 'SOUL.md':`# Personality

Be warm, concise and natural. Match the sender’s current language and texting style. Avoid repeated introductions, forced humour and unnecessary follow-up questions.`,
 'OWNER.md':`# Approved owner information

No owner biography has been provided. Do not invent personal details.`,
 'RULES.md':`# Conversation rules

Stay silent when a response is not useful. Respect finished conversations. Involve the owner when personal attention is required. Handover acknowledgements must fit the conversation and personality; do not promise a response time.`,
 'KNOWLEDGE.md':`# Business information

Add approved services, pricing, FAQs and facts here.`,
 'MEMORY.md':`# Approved global memory

Add owner-approved workspace preferences here. Individual customer memory is managed separately.`
};}
export function legacyDocuments(org:string,k:Knowledge):AgentDocument[]{const defaults=documentDefaults(k.businessName);return documentNames.map(name=>({organization_id:org,name,content:name==='SOUL.md'?[k.instructions||defaults[name],k.tone?'Configured tone: '+k.tone+'.':''].filter(Boolean).join('\n\n'):name==='RULES.md'?[defaults[name],k.escalationRules,k.neverClaims].filter(Boolean).join('\n\n'):name==='KNOWLEDGE.md'?[k.description,...k.facts.map(f=>`## ${f.question}
${f.answer}`)].filter(Boolean).join('\n\n')||defaults[name]:defaults[name],enabled:true,max_tokens:1200,version:1}));}
export async function loadAgentConfiguration(db:any,org:string,k:Knowledge):Promise<AgentConfiguration>{
 const read=async()=>{const rows=(await db.query('select d.*,row_to_json(s) as settings from agent_documents d join agent_settings s on s.organization_id=d.organization_id where d.organization_id=$1 order by d.name',[org])).rows;return rows.length===6?{organization_id:org,documents:rows.map((row:any)=>{const d={...row};delete d.settings;return d;}),settings:rows[0].settings} as AgentConfiguration:null;};
 const existing=await read();if(existing)return existing;
 await db.query('insert into agent_settings(organization_id) values($1) on conflict do nothing',[org]);
 if(!k.businessName)k={...k,businessName:(await db.query('select name from organizations where id=$1',[org])).rows[0]?.name||''};
 await db.query(`insert into agent_documents(organization_id,name,content) select $1,d.name,d.content from jsonb_to_recordset($2::jsonb) d(name text,content text) on conflict do nothing`,[org,JSON.stringify(legacyDocuments(org,k))]);
 await db.query('insert into agent_document_versions(organization_id,name,version,content,enabled,max_tokens) select organization_id,name,version,content,enabled,max_tokens from agent_documents where organization_id=$1 on conflict do nothing',[org]);
 const result=await read();if(!result)throw Error('Agent configuration unavailable');return result;
}
// A conservative UTF-8 estimate handles Urdu/Punjabi without English-only character ratios.
export const estimateTokens=(text:string)=>Math.ceil(Buffer.byteLength(text,'utf8')/3);
export function truncateTokens(text:string,budget:number){let size=Math.min(text.length,budget*3);while(size>0&&estimateTokens(text.slice(0,size))>budget)size=Math.floor(size*.9);return text.slice(0,size);}
export function assembleAgent(config:AgentConfiguration,query:string,recent:string[],budget?:number){
 const stop=new Set('the this that your you what how does do for from with have and are can would should my is of to in it me we our'.split(' '));
 const terms=new Set(((query+' '+recent.slice(-3).join(' ')).toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu)||[]).filter(t=>!stop.has(t)).slice(0,96));
 const total=budget??Math.floor(config.settings.context_tokens*.55);let remaining=total;const used:{name:DocumentName;version:number;tokens:number;truncated:boolean}[]=[];const blocks:string[]=[];
 const ordered=[...config.documents].sort((a,b)=>Number(essential.has(b.name))-Number(essential.has(a.name)));
 for(const d of ordered){if(!d.enabled&&!essential.has(d.name))continue;
  const parts=d.content.split(/\n\s*\n/).filter(Boolean).flatMap(part=>part.length<=2400?[part]:Array.from({length:Math.ceil(part.length/2000)},(_,i)=>part.slice(i*2000,i*2000+2400)));
  const ranked=parts.map((text,index)=>{const words=new Set(text.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu)||[]);return {text,index,score:[...terms].reduce((n,t)=>n+(words.has(t)?1:0),0)}}).sort((a,b)=>b.score-a.score||a.index-b.index);
  const source=essential.has(d.name)?d.content:ranked.filter(p=>p.score>0).slice(0,4).sort((a,b)=>a.index-b.index).map(p=>p.text).join('\n\n');
  const cap=Math.min(d.max_tokens,remaining,essential.has(d.name)?Math.floor(total*.26):600);if(!source||cap<32)continue;
  const content=truncateTokens(source,cap),tokens=estimateTokens(content);remaining-=tokens;used.push({name:d.name,version:d.version,tokens,truncated:content.length<d.content.length});blocks.push(`DOCUMENT ${d.name} (owner-authored, version ${d.version}):
${content}`);
 }
 return {content:blocks.join('\n\n'),used,tokens:used.reduce((n,d)=>n+d.tokens,0)};
}
