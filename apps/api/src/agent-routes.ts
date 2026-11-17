import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {FastifyInstance} from 'fastify';
import {defaultKnowledge,knowledgeSchema,DEFAULT_REVISION_ID} from './knowledge.js';
import {DeepSeek,type Context} from './ai.js';
import {processAssistantTurn} from './conversation-engine.js';
import {documentNames,documentDefaults,essential,loadAgentConfiguration,type DocumentName} from './agent-config.js';
type Tenant=(req:any,owner:boolean,fn:(db:any,org:string,actor:string)=>Promise<any>)=>Promise<any>;
export class AgentConflict extends Error {}
const nameSchema=z.enum(documentNames);
const updateSchema=z.object({version:z.number().int().positive(),content:z.string().max(320000),enabled:z.boolean(),max_tokens:z.number().int().min(64).max(3000)}).strict();
async function legacy(db:any,org:string){const row=(await db.query('select r.* from knowledge_publications p join knowledge_revisions r on r.organization_id=p.organization_id and r.id=p.revision_id where p.organization_id=$1',[org])).rows[0];return row?{...row,content:knowledgeSchema.parse(row.content)}:{id:DEFAULT_REVISION_ID,organization_id:org,content:{...defaultKnowledge(),businessName:(await db.query('select name from organizations where id=$1',[org])).rows[0]?.name||''}};}
async function save(db:any,org:string,actor:string,name:DocumentName,value:z.infer<typeof updateSchema>){
 if(essential.has(name)&&!value.enabled)throw new z.ZodError([{code:'custom',path:['enabled'],message:'Essential agent documents must stay enabled.'}]);
 const row=(await db.query('update agent_documents set content=$3,enabled=$4,max_tokens=$5,version=version+1,updated_at=now() where organization_id=$1 and name=$2 and version=$6 returning *',[org,name,value.content,value.enabled,value.max_tokens,value.version])).rows[0];
 if(!row)throw new AgentConflict('This document changed in another session. Reload before saving.');
 await db.query('insert into agent_document_versions(organization_id,name,version,content,enabled,max_tokens,created_by) values($1,$2,$3,$4,$5,$6,$7)',[org,name,row.version,row.content,row.enabled,row.max_tokens,actor]);
 await db.query('update agent_settings set revision=revision+1,updated_at=now() where organization_id=$1',[org]);
 await db.query("insert into audit_logs(organization_id,actor_id,event) values($1,$2,'agent_document_saved')",[org,actor]);return row;
}
export function registerAgentRoutes(app:FastifyInstance,tenant:Tenant){
 app.get('/organizations/:org/agent',req=>tenant(req,true,async(db,org)=>loadAgentConfiguration(db,org,(await legacy(db,org)).content)));
 app.put('/organizations/:org/agent/documents/:name',{bodyLimit:2*1024*1024},req=>tenant(req,true,(db,org,actor)=>save(db,org,actor,nameSchema.parse((req.params as any).name),updateSchema.parse(req.body))));
 app.get('/organizations/:org/agent/documents/:name/versions',req=>tenant(req,true,async(db,org)=>{
  const name=nameSchema.parse((req.params as any).name),{before}=z.object({before:z.coerce.number().int().positive().optional()}).strict().parse(req.query);
  const rows=(await db.query('select version,content,enabled,max_tokens,created_at from agent_document_versions where organization_id=$1 and name=$2 and ($3::integer is null or version<$3) order by version desc limit 31',[org,name,before||null])).rows;return {versions:rows.slice(0,30),hasMore:rows.length>30};
 }));
 app.post('/organizations/:org/agent/documents/:name/restore',req=>tenant(req,true,async(db,org,actor)=>{
  const name=nameSchema.parse((req.params as any).name),body=z.object({version:z.number().int().positive(),restoreVersion:z.number().int().positive().optional(),defaults:z.boolean().optional()}).strict().refine(v=>!!v.restoreVersion!==!!v.defaults,'Choose one restore source.').parse(req.body);
  const source=body.defaults?{content:documentDefaults((await legacy(db,org)).content.businessName)[name],enabled:true,max_tokens:1200}:(await db.query('select content,enabled,max_tokens from agent_document_versions where organization_id=$1 and name=$2 and version=$3',[org,name,body.restoreVersion])).rows[0];
  if(!source)throw new z.ZodError([{code:'custom',path:['restoreVersion'],message:'Version is not available in this workspace.'}]);
  return save(db,org,actor,name,{...source,version:body.version});
 }));
 app.patch('/organizations/:org/agent/settings',req=>tenant(req,true,async(db,org)=>{
  const v=z.object({revision:z.number().int().positive(),context_tokens:z.number().int().min(4096).max(16000),history_messages:z.number().int().min(4).max(60),response_tokens:z.number().int().min(100).max(1200)}).strict().parse(req.body);
  const row=(await db.query('update agent_settings set context_tokens=$2,history_messages=$3,response_tokens=$4,revision=revision+1,updated_at=now() where organization_id=$1 and revision=$5 returning *',[org,v.context_tokens,v.history_messages,v.response_tokens,v.revision])).rows[0];if(!row)throw new AgentConflict('Configuration changed. Reload settings.');return row;
 }));
 app.post('/organizations/:org/agent/playground',{bodyLimit:2*1024*1024,config:{rateLimit:{max:20,timeWindow:'1 minute'}}},async req=>{
  const body=z.object({message:z.string().trim().min(1).max(8000),history:z.array(z.object({sender:z.enum(['customer','ai']),content:z.string().max(8000),created_at:z.string().datetime().optional()}).strict()).max(60).default([]),mode:z.enum(['active','human']).default('active')}).strict().parse(req.body);
  // Finish the read transaction before provider I/O. No live contact, account, queue or booking exists.
  const c:Context=await tenant(req,true,async(db,org)=>{const revision=await legacy(db,org),agent=await loadAgentConfiguration(db,org,revision.content),conversation=randomUUID(),contact=randomUUID(),account=randomUUID();return {
   organization_id:org,currentMessageAt:new Date().toISOString(),revision,agent,account:{id:account,organization_id:org,session_id:'playground',authenticated_jid:'playground@s.whatsapp.net',status:'connected',owner_availability:'away'},
   conversation:{id:conversation,organization_id:org,account_id:account,contact_id:contact,mode:body.mode},contact:{id:contact,organization_id:org,identity:'playground@lid',ai_opt_out:false},memories:[],
   history:body.history.map(m=>({...m,organization_id:org,conversation_id:conversation,ai_context_source:m.sender==='customer'?'user':'assistant'}))
  };});
  const started=Date.now(),result=await processAssistantTurn(c,body.message,new DeepSeek(),{dryRun:true});
  return {...result,latencyMs:Date.now()-started};
 });
}
