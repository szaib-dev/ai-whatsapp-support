import "dotenv/config";
import {conversationIdentities,groupConversations,equivalentConversations} from './contact-identity.js';
import {PushWorker} from './notifications.js';
import {setConversationMode} from './attention-routes.js';
import {validateEnvironment} from "./config.js";
import {registerStatusPortal} from "./status-portal.js";
import {registerCalendarRoutes} from "./calendar-routes.js";
import {WorkspaceChanges} from "./live-updates.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { pool, privacyLocks, Forbidden } from "./db.js";
import { knowledgeSchema, parseDocument } from "./knowledge.js";
import { WhatsAppManager } from "./whatsapp.js";
import { MESSAGE_POLICY } from "./dispatcher.js";
const uuid = z.string().uuid();
class Unavailable extends Error {}
export async function buildServer(whatsapp?: WhatsAppManager,options:{pushWorker?:boolean}={}) {
  const app = Fastify({
    bodyLimit: 400 * 1024,
    trustProxy:process.env.NODE_ENV==='production'?(_address:string,hop:number)=>hop<1:false,
    logger: { redact: ["req.headers.authorization", "req.headers.cookie", "req.body", "res.body", "res.headers.set-cookie"], serializers:{req:(req:any)=>({method:req.method,url:String(req.url||'').split('?')[0].replace(/(\/calendar\/connect\/)[^/]+/,'$1[redacted]'),remoteAddress:req.ip})} },
  });
  app.addContentTypeParser('application/x-www-form-urlencoded',{parseAs:'string'},(_req,body,done)=>done(null,Object.fromEntries(new URLSearchParams(String(body)))));
  await app.register(cors, {
    origin: process.env.WEB_ORIGIN || "http://localhost:3000",
    methods: ["GET","HEAD","POST","PUT","PATCH","DELETE","OPTIONS"],
    credentials: true,
  });
  await app.register(rateLimit, { max: 240, timeWindow: "1 minute" });
  app.addHook("onSend", async (_req, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Cache-Control", "no-store")
      .header("Referrer-Policy","no-referrer")
      .header("X-Robots-Tag","noindex, nofollow");
  });
  app.setErrorHandler((error, _req, reply) => {
    const status =
      (error as any)?.statusCode===429 ? 429 :
      error instanceof Forbidden
        ? 403
        : error instanceof Unavailable
          ? 503
        : error instanceof z.ZodError
          ? 400
          : 500;
    if (status === 500)
      app.log.error(
        { err: { name: error instanceof Error ? error.name : "Unknown",code:(error as any)?.code||"UNKNOWN" } },
        "Request failed",
      );
    reply
      .code(status)
      .send({
        ...(error instanceof z.ZodError ? {
          issues: error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })),
        } : {}),
        error:
          status === 429 ? "Too many requests" : status === 403
            ? "Forbidden"
            : status === 400
              ? "Invalid input"
              : status === 503 ? "Service temporarily unavailable" : "Request failed",
      });
  });
  const auth = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    { auth: { persistSession: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) }) } },
  );
  const verifying=new Map<string,Promise<any>>();
  async function user(req: { headers: { authorization?: string } }) {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new Forbidden();
    let work=verifying.get(token);
    if(!work){work=auth.auth.getUser(token);verifying.set(token,work);void work.finally(()=>verifying.delete(token)).catch(()=>{});}
    const { data, error } = await work;
    if (error && (error.name === "AuthRetryableFetchError" || (error.status || 0) >= 500)) throw new Unavailable();
    if (error || !data.user) throw new Forbidden();
    return data.user.id;
  }
  // Lock membership while mutating: no permission-check/write race. Tenant ID is only a selector.
  async function tenant(
    req: any,
    owner: boolean,
    fn: (db: any, org: string, actor: string) => Promise<unknown>,
  ) {
    const actor = await user(req),
      org = uuid.parse(req.params.org),
      db = await pool.connect();
    try {
      await db.query("begin");
      const m = (
        await db.query(
          "select role from organization_members where organization_id=$1 and user_id=$2 for share",
          [org, actor],
        )
      ).rows[0];
      if (!m || (owner && m.role !== "owner")) throw new Forbidden();
      const result = await fn(db, org, actor);
      await db.query("commit");
      return result;
    } catch (e) {
      await db.query("rollback");
      throw e;
    } finally {
      db.release();
    }
  }
  async function administrator(req:any){const actor=await user(req);const member=(await pool.query('select 1 from organization_members where user_id=$1 limit 1',[actor])).rows.length;const bootstrap=(process.env.ADMIN_USER_IDS||'').split(',').map(v=>v.trim()).includes(actor);if(!member&&!bootstrap)throw new Forbidden();return actor;}
  app.delete('/push-device',async req=>{
    const actor=await user(req),{endpoint}=z.object({endpoint:z.string().max(2048)}).strict().parse(req.body);
    await pool.query('delete from push_subscriptions where principal=$1 and endpoint=$2',['admin:'+actor,endpoint]);return {ok:true};
  });
  app.get('/admin/session',async req=>{await administrator(req);return {authorized:true};});
  app.get('/ready',async(_req,reply)=>{try{await pool.query('select 1');if(process.env.SESSION_ENCRYPTION_KEY&&!whatsapp?.ready)return reply.code(503).send({status:'recovering'});return {status:'ready'};}catch(error){app.log.warn({code:(error as any)?.code||'UNKNOWN'},'Readiness database probe failed');return reply.code(503).send({status:'unavailable'});}});
  const pushWorker=new PushWorker();
  app.addHook('onReady',async()=>{if(options.pushWorker!==false)pushWorker.start()});
  app.addHook('preClose',async()=>{await pushWorker.close()});
  registerStatusPortal(app,tenant,whatsapp);
  registerCalendarRoutes(app,tenant);
  const streams=new Set<any>();
  app.addHook('preClose',async()=>{for(const stream of streams)stream.end();streams.clear()});
  const changes=new WorkspaceChanges();
  app.addHook('onClose',async()=>changes.close());
  app.get('/organizations/:org/events',async(req,reply)=>{
    const actor=await user(req),org=uuid.parse((req.params as any).org);
    const allowed=()=>pool.query('select 1 from organization_members where organization_id=$1 and user_id=$2',[org,actor]);
    if(!(await allowed()).rowCount)throw new Forbidden();
    const unsubscribe=await changes.subscribe(changed=>{
      if(changed==='*'){reply.raw.end();return;}
      if(changed===org&&!reply.raw.destroyed)reply.raw.write('data: changed\n\n');
    });
    streams.add(reply.raw);reply.hijack();reply.raw.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','Access-Control-Allow-Origin':process.env.WEB_ORIGIN||'http://localhost:3000','X-Accel-Buffering':'no'});
    reply.raw.write('data: connected\n\n');
    const heartbeat=setInterval(()=>{void allowed().then(r=>{if(!r.rowCount)reply.raw.end();else reply.raw.write(': heartbeat\n\n')}).catch(()=>reply.raw.end())},25000);heartbeat.unref();
    const close=()=>{streams.delete(reply.raw);clearInterval(heartbeat);unsubscribe()};reply.raw.on('close',close);
  });
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/organizations/:org/whatsapp", req => tenant(req, true, async (db, org) => {
    const accounts = (await db.query("select id,status,authenticated_jid,owner_availability,owner_status_at,last_connected_at,last_connection_error,needs_pairing from whatsapp_accounts where organization_id=$1 and removed_at is null order by id", [org])).rows;
    const policy=(await db.query('select reply_only_when_away from organizations where id=$1',[org])).rows[0];
    return { onlyWhenAway:!!policy?.reply_only_when_away, enabled: !!whatsapp?.ready, accounts: accounts.map((a: any) => ({ ...a, status: whatsapp?.state(org, a.id, a.status) || a.status, qr: whatsapp?.qr(org, a.id) || null })) };
  }));
  app.patch('/organizations/:org/owner-availability',req=>tenant(req,true,async(db,org,actor)=>{
    const value=z.object({onlyWhenAway:z.boolean(),accountId:uuid.optional(),availability:z.enum(['online','away']).optional()}).refine(v=>!v.availability||!!v.accountId).parse(req.body);
    await db.query('update organizations set reply_only_when_away=$2 where id=$1',[org,value.onlyWhenAway]);
    if(value.accountId&&value.availability){const result=await db.query('update whatsapp_accounts set owner_availability=$3,owner_status_at=now() where organization_id=$1 and id=$2 and removed_at is null returning id',[org,value.accountId,value.availability]);if(!result.rowCount)throw new Forbidden();}
    await db.query("insert into audit_logs(organization_id,actor_id,event) values($1,$2,'owner_availability_updated')",[org,actor]);return {ok:true};
  }));
  app.post("/organizations/:org/whatsapp", req => tenant(req, true, async (db, org, actor) => {
    const row = (await db.query("insert into whatsapp_accounts(organization_id) values($1) returning id", [org])).rows[0];
    await db.query("insert into audit_logs(organization_id,actor_id,event,resource_id) values($1,$2,'whatsapp_account_created',$3)", [org, actor, row.id]);
    return row;
  }));
  app.post("/organizations/:org/whatsapp/:id/:action", req => tenant(req, true, async (db, org, actor) => {
    const params = z.object({ id: uuid, action: z.enum(["connect", "disconnect", "unlink", "remove"]) }).parse(req.params);
    const account = (await db.query("select id,status from whatsapp_accounts where organization_id=$1 and id=$2 and removed_at is null", [org, params.id])).rows[0];
    if (!account) throw new Forbidden();
    if (!whatsapp) throw new Error("WhatsApp is not configured");
    if (params.action === "connect") {
      await whatsapp.ensureConnected(org,params.id);
    }
    else if (params.action === 'disconnect') await whatsapp.stop(org, params.id);
    else {
      await whatsapp.unlink(org, params.id);
      await db.query("update whatsapp_inbox set state='failed',last_error='Account unlinked by owner' where organization_id=$1 and account_id=$2 and state='pending'",[org,params.id]);
      if(params.action==='remove') await db.query('update whatsapp_accounts set removed_at=now() where organization_id=$1 and id=$2',[org,params.id]);
    }
    await db.query("insert into audit_logs(organization_id,actor_id,event,resource_id) values($1,$2,$3,$4)", [org, actor, `whatsapp_${params.action}_requested`, params.id]);
    return { ok: true };
  }));
  app.get("/organizations", async (req) => {
    const actor = await administrator(req);
    const businesses=(
      await pool.query(
        `select o.*,m.role,
          (select count(*)::int from whatsapp_accounts a where a.organization_id=o.id and a.removed_at is null and a.status='connected') as connected_accounts,
          (select count(*)::int from whatsapp_accounts a where a.organization_id=o.id and a.removed_at is null) as total_accounts,
          (select count(*)::int from conversations c where c.organization_id=o.id) as conversations,
          (select count(*)::int from messages s where s.organization_id=o.id and s.sender='ai' and s.status='sent') as replies,
          (select r.content->>'aiEnabled' from knowledge_publications p join knowledge_revisions r on r.organization_id=p.organization_id and r.id=p.revision_id where p.organization_id=o.id) as ai_enabled
        from organizations o join organization_members m on m.organization_id=o.id where m.user_id=$1 order by o.created_at,o.name`,
        [actor],
      )
    ).rows;
    const accounts=(await pool.query('select id,organization_id,status from whatsapp_accounts where removed_at is null and organization_id=any($1::uuid[])',[businesses.map(b=>b.id)])).rows;
    return businesses.map(b=>({...b,connected_accounts:accounts.filter(a=>a.organization_id===b.id&&whatsapp?.ready&&whatsapp.state(b.id,a.id,a.status)==='connected').length}));
  });
  app.post('/organizations',async req=>{
    const actor=await administrator(req);
    const {name}=z.object({name:z.string().trim().min(1).max(160)}).strict().parse(req.body);
    const db=await pool.connect();
    try{await db.query('begin');const org=(await db.query('insert into organizations(name) values($1) returning *',[name])).rows[0];
      await db.query("insert into organization_members values($1,$2,'owner')",[org.id,actor]);
      await db.query("insert into audit_logs(organization_id,actor_id,event) values($1,$2,'business_created')",[org.id,actor]);
      await db.query('commit');return {...org,role:'owner',connected_accounts:0,total_accounts:0,conversations:0,replies:0};
    }catch(e){await db.query('rollback');throw e;}finally{db.release();}
  });
  app.patch('/organizations/:org',req=>tenant(req,true,async(db,org,actor)=>{
    const {name}=z.object({name:z.string().trim().min(1).max(160)}).strict().parse(req.body);
    await db.query('update organizations set name=$2 where id=$1',[org,name]);
    await db.query("insert into audit_logs(organization_id,actor_id,event) values($1,$2,'business_renamed')",[org,actor]);return {name};
  }));
  app.get('/organizations/:org/overview',req=>tenant(req,false,async(db,org)=>({
    policy:{...MESSAGE_POLICY,...(await db.query('select reply_delay_ms as \"quietMs\",reply_max_wait_ms as \"maxWaitMs\" from organizations where id=$1',[org])).rows[0]},
    stats:(await db.query(`select
      (select count(*)::int from contacts where organization_id=$1) as contacts,
      (select count(*)::int from messages where organization_id=$1 and sender='customer') as received,
      (select count(*)::int from messages where organization_id=$1 and sender='ai' and status='sent') as sent,
      (select count(*)::int from conversations where organization_id=$1 and mode='human') as needs_attention,
      (select count(*)::int from whatsapp_inbox where organization_id=$1 and state='pending') as queued,
      (select count(*)::int from whatsapp_inbox where organization_id=$1 and state='processing') as processing,
      (select count(*)::int from whatsapp_inbox where organization_id=$1 and state='uncertain') as uncertain,
      (select count(*)::int from contact_memories where organization_id=$1 and expires_at>now()) as memories`,[org])).rows[0],
    daily:(await db.query("select date_trunc('day',created_at) as day,count(*)::int as total,count(*) filter(where sender='ai')::int as replies from messages where organization_id=$1 and created_at>=now()-interval '7 days' group by 1 order by 1",[org])).rows,
  })));
  app.patch('/organizations/:org/reply-settings',req=>tenant(req,true,async(db,org,actor)=>{
    const value=z.object({delayMs:z.number().int().min(0).max(30000),maxWaitMs:z.number().int().min(1000).max(60000)}).refine(v=>v.maxWaitMs>=v.delayMs,'Maximum wait must be at least the reply delay').parse(req.body);
    await db.query('update organizations set reply_delay_ms=$2,reply_max_wait_ms=$3 where id=$1',[org,value.delayMs,value.maxWaitMs]);
    await db.query("insert into audit_logs(organization_id,actor_id,event) values($1,$2,'reply_timing_updated')",[org,actor]);return value;
  }));
  app.post('/organizations/:org/conversations/:id/send',req=>tenant(req,false,async(db,org,actor)=>{
    const {text,requestId}=z.object({text:z.string().trim().min(1).max(8000),requestId:uuid}).parse(req.body);
    const id=uuid.parse((req.params as any).id);
    const c=(await db.query('select c.*,p.identity from conversations c join contacts p on p.organization_id=c.organization_id and p.id=c.contact_id where c.organization_id=$1 and c.id=$2',[org,id])).rows[0];
    if(!c)throw new Forbidden();
    const account=(await db.query('select * from whatsapp_accounts where organization_id=$1 and id=$2 for no key update',[org,c.account_id])).rows[0];
    if(!whatsapp?.ready || account?.status!=='connected' || account?.removed_at)throw new Unavailable();
    const existing=(await db.query('select status from messages where organization_id=$1 and conversation_id=$2 and external_id=$3',[org,id,requestId])).rows[0];
    if(existing)return existing;
    await setConversationMode(db,org,id,'human');
    const ids=await equivalentConversations(db,org,id);
    await db.query("update conversations set last_owner_message_at=now(),owner_pause_until=now()+interval '30 minutes',handoff_reason='Owner replied from dashboard' where organization_id=$1 and id=any($2::uuid[])",[org,ids]);
    await db.query("insert into messages(organization_id,conversation_id,external_id,sender,content,status) values($1,$2,$3,'staff',$4,'sending')",[org,id,requestId,text]);
    // Persist intent before the external effect. Duplicate request IDs never resend.
    await db.query('commit');await db.query('begin');
    let status='sent';
    try{await whatsapp.sendStaff(org,c.account_id,c.identity,text,requestId.replaceAll('-','').toUpperCase());}catch{status='uncertain';}
    await db.query('update messages set status=$4 where organization_id=$1 and conversation_id=$2 and external_id=$3',[org,id,requestId,status]);
    await db.query("insert into audit_logs(organization_id,actor_id,event,resource_id) values($1,$2,'staff_message_'||$4::text,$3)",[org,actor,id,status]);return {status};
  }));
  app.get("/organizations/:org/knowledge", (req) =>
    tenant(req, false, async (db, org) => ({
      revisions: (
        await db.query(
          "select * from knowledge_revisions where organization_id=$1 order by created_at desc limit 100",
          [org],
        )
      ).rows,
      publication:
        (
          await db.query(
            "select * from knowledge_publications where organization_id=$1",
            [org],
          )
        ).rows[0] ?? null,
    })),
  );
  app.post("/organizations/:org/knowledge", (req) =>
    tenant(req, false, async (db, org, actor) => {
      const content = knowledgeSchema.parse(req.body);
      const r = (
        await db.query(
          "insert into knowledge_revisions(organization_id,content,created_by) values($1,$2,$3) returning *",
          [org, content, actor],
        )
      ).rows[0];
      await db.query(
        "insert into audit_logs(organization_id,actor_id,event,resource_id) values($1,$2,'knowledge_drafted',$3)",
        [org, actor, r.id],
      );
      return r;
    }),
  );
  app.post("/organizations/:org/publish", (req) =>
    tenant(req, true, async (db, org, actor) => {
      const { revisionId } = z
        .object({ revisionId: uuid })
        .strict()
        .parse(req.body);
      const r = (
        await db.query(
          "select * from knowledge_revisions where organization_id=$1 and id=$2",
          [org, revisionId],
        )
      ).rows[0];
      if (!r) throw new Forbidden();
      knowledgeSchema.parse(r.content);
      await db.query(
        "insert into knowledge_publications(organization_id,revision_id,published_by) values($1,$2,$3) on conflict(organization_id) do update set revision_id=excluded.revision_id,published_by=excluded.published_by,published_at=now()",
        [org, revisionId, actor],
      );
      await db.query(
        "insert into audit_logs(organization_id,actor_id,event,resource_id) values($1,$2,'knowledge_published',$3)",
        [org, actor, revisionId],
      );
      return { published: true };
    }),
  );
  app.post("/organizations/:org/documents/parse", (req) =>
    tenant(req, false, async (db, org, actor) => {
      const b = z
        .object({
          filename: z.string().max(255),
          base64: z.string().max(350000),
        })
        .strict()
        .parse(req.body);
      let text: string;
      try {
        text = parseDocument(b.filename, Buffer.from(b.base64, "base64"));
      } catch {
        throw new z.ZodError([
          { code: "custom", path: [], message: "Invalid document" },
        ]);
      }
      const doc = (
        await db.query(
          "insert into knowledge_documents(organization_id,filename,content,created_by) values($1,$2,$3,$4) returning id",
          [org, b.filename, text, actor],
        )
      ).rows[0];
      await db.query(
        "insert into audit_logs(organization_id,actor_id,event,resource_id) values($1,$2,'document_uploaded_for_review',$3)",
        [org, actor, doc.id],
      );
      return { id: doc.id, text, status: "review_required" };
    }),
  );
  app.get("/organizations/:org/documents", (req) =>
    tenant(
      req,
      false,
      async (db, org) =>
        (
          await db.query(
            "select id,filename,created_at from knowledge_documents where organization_id=$1 order by created_at desc limit 100",
            [org],
          )
        ).rows,
    ),
  );
  app.get("/organizations/:org/documents/:id", (req) =>
    tenant(req, false, async (db, org) => {
      const r = (
        await db.query(
          "select * from knowledge_documents where organization_id=$1 and id=$2",
          [org, uuid.parse((req.params as any).id)],
        )
      ).rows[0];
      if (!r) throw new Forbidden();
      return r;
    }),
  );
  app.get("/organizations/:org/audit", (req) =>
    tenant(
      req,
      false,
      async (db, org) =>
        (
          await db.query(
            "select * from audit_logs where organization_id=$1 order by created_at desc limit 100",
            [org],
          )
        ).rows,
    ),
  );
  app.get('/organizations/:org/conversations',req=>tenant(req,false,async(db,org)=>groupConversations(await conversationIdentities(db,org))));
  app.post('/organizations/:org/conversations/:id/read',req=>tenant(req,false,async(db,org)=>{const ids=await equivalentConversations(db,org,uuid.parse((req.params as any).id));if(!ids.length)throw new Forbidden();await db.query('update conversations set last_read_at=now() where organization_id=$1 and id=any($2::uuid[])',[org,ids]);return {ok:true};}));
  app.get("/organizations/:org/conversations/:id", (req) =>
    tenant(req, false, async (db, org) => {
      const id = uuid.parse((req.params as any).id),
        c = (
          await db.query(
            "select c.*,p.identity,p.display_name from conversations c join contacts p on p.organization_id=c.organization_id and p.id=c.contact_id where c.organization_id=$1 and c.id=$2",
            [org, id],
          )
        ).rows[0];
      if (!c) throw new Forbidden();
      const ids=await equivalentConversations(db,org,id);
      const identity=groupConversations(await conversationIdentities(db,org,ids)).find((r:any)=>r.conversation_ids.includes(id));
      return {
        conversation: {...c,...identity,id:c.id,contact_id:c.contact_id},
        messages: (
          await db.query(
            "select * from messages where organization_id=$1 and conversation_id=any($2::uuid[]) and created_at>=now()-interval '30 days' order by created_at desc limit 100",
            [org, ids],
          )
        ).rows.reverse(),
        memories: (
          await db.query(
            "select * from contact_memories where organization_id=$1 and contact_id=$2 and expires_at>now() order by created_at desc limit 20",
            [org, c.contact_id],
          )
        ).rows,
      };
    }),
  );
  app.post("/organizations/:org/conversations/:id/mode", (req) =>
    tenant(req, false, async (db, org, actor) => {
      const id = uuid.parse((req.params as any).id),
        { mode } = z
          .object({ mode: z.enum(["active", "human", "paused"]) })
          .strict()
          .parse(req.body);
      await setConversationMode(db,org,id,mode);
      await db.query(
        "insert into audit_logs(organization_id,actor_id,event,resource_id) values($1,$2,$3,$4)",
        [org, actor, `conversation_${mode}`, id],
      );
      return { mode };
    }),
  );
  app.delete("/organizations/:org/contacts/:id/memories/:memory", (req) =>
    tenant(req, false, async (db, org, actor) => {
      const p = req.params as any,
        id = uuid.parse(p.id),
        memory = uuid.parse(p.memory);
      await db.query(
        "delete from contact_memories where organization_id=$1 and contact_id=$2 and id=$3",
        [org, id, memory],
      );
      await db.query(
        "insert into audit_logs(organization_id,actor_id,event,resource_id) values($1,$2,'memory_deleted',$3)",
        [org, actor, memory],
      );
      return { deleted: true };
    }),
  );
  app.addHook("onClose", async () => {
    await whatsapp?.close();
    await privacyLocks.end();
    await pool.end();
  });
  return app;
}
if (
  process.argv[1]?.endsWith("server.ts") ||
  process.argv[1]?.endsWith("server.js")
) {
  validateEnvironment();
  const whatsapp = process.env.SESSION_ENCRYPTION_KEY ? new WhatsAppManager(process.env.SESSION_ENCRYPTION_KEY) : undefined;
  if (whatsapp) {
    try { await whatsapp.initialize(); }
    catch { console.error("WhatsApp database temporarily unavailable; recovery scheduled"); whatsapp.recover(); }
  }
  const app = await buildServer(whatsapp);
  await app.listen({
    port: Number(process.env.PORT || 3101),
    host: process.env.HOST || "127.0.0.1",
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      void app.close();
    });
}

