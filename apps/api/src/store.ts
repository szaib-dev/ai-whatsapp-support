import {withChatPrivacy} from './chat-privacy.js';
import {OwnerDeferred} from "./owner-availability.js";
import { pool, audit, publication } from "./db.js";
import { knowledgeSchema, defaultKnowledge, DEFAULT_REVISION_ID } from "./knowledge.js";
import { validateContext, TenantMismatch, type Context } from "./ai.js";
import type { Incoming, SessionBinding, Store } from "./pipeline.js";
import { explicitName } from "./memory.js";
export class PgStore implements Store {
  async resolve(session: string): Promise<SessionBinding> {
    const { rows } = await pool.query(
      "select * from whatsapp_accounts where session_id=$1 and status='connected' and authenticated_jid is not null",
      [session],
    );
    if (rows.length !== 1)
      throw new TenantMismatch("Unknown authenticated session");
    const a = rows[0];
    return {
      session,
      organization: a.organization_id,
      account: a.id,
      authenticatedJid: a.authenticated_jid,
    };
  }
  async guard(b:SessionBinding,e:Incoming,work:()=>Promise<void>){return withChatPrivacy(b.organization,b.account,e.jid,work,earliest(e));}
  async load(b:SessionBinding,e:Incoming):Promise<Context|null>{return await withChatPrivacy(b.organization,b.account,e.jid,()=>this.loadAllowed(b,e),earliest(e))??null;}
  private async loadAllowed(b: SessionBinding, e: Incoming): Promise<Context | null> {
    const org = b.organization;
    const contact = (
      await pool.query(
        "insert into contacts(organization_id,identity) values($1,$2) on conflict(organization_id,identity) do update set identity=excluded.identity returning *",
        [org, e.jid],
      )
    ).rows[0];
    const conversation = (
      await pool.query(
        "insert into conversations(organization_id,account_id,contact_id) values($1,$2,$3) on conflict(organization_id,account_id,contact_id) do update set contact_id=excluded.contact_id returning *",
        [org, b.account, contact.id],
      )
    ).rows[0];
    const parts=e.parts?.length ? e.parts : [e];
    if(parts.some(p=>p.jid!==e.jid))throw new TenantMismatch('Mixed customer batch');
    await pool.query("insert into messages(organization_id,conversation_id,external_id,sender,content,ai_context_source) select $1::uuid,$2::uuid,v.id,'customer',v.text,'user' from jsonb_to_recordset($3::jsonb) as v(id text,text text) on conflict do nothing",[org,conversation.id,JSON.stringify(parts.map(p=>({id:p.id,text:p.text})))]);
    const name=explicitName(e.text);
    if(name){
      const source=(await pool.query('select id from messages where organization_id=$1 and conversation_id=$2 and external_id=$3',[org,conversation.id,parts[parts.length-1].id])).rows[0];
      await pool.query("insert into contact_memories(organization_id,contact_id,source_message_id,content,provenance,kind,expires_at) values($1,$2,$3,$4,'customer_statement','preferred_name',now()+interval '30 days') on conflict(organization_id,contact_id,kind) where kind='preferred_name' do update set content=excluded.content,source_message_id=excluded.source_message_id,created_at=now(),expires_at=excluded.expires_at",[org,contact.id,source.id,JSON.stringify({name})]);
      await pool.query('update contacts set display_name=$3 where organization_id=$1 and id=$2',[org,contact.id,name]);
    }
    const published = await publication(org);
    const revision = published ? { ...published, content: knowledgeSchema.parse(published.content) } : { id: DEFAULT_REVISION_ID, organization_id: org, content: defaultKnowledge() };
    const account = (
      await pool.query(
        "select * from whatsapp_accounts where organization_id=$1 and id=$2 and session_id=$3",
        [org, b.account, b.session],
      )
    ).rows[0];
    const memories = (
      await pool.query(
        "select m.*,s.ai_context_source from contact_memories m join messages s on s.organization_id=m.organization_id and s.id=m.source_message_id join conversations c on c.organization_id=s.organization_id and c.id=s.conversation_id where m.organization_id=$1 and m.contact_id=$2 and c.contact_id=$2 and m.expires_at>now() order by m.created_at desc limit 20",
        [org, contact.id],
      )
    ).rows;
    const history = (
      await pool.query(
        `select m.* from messages m where m.organization_id=$1 and m.conversation_id=$2
          and m.created_at>=now()-interval '30 days' and not (m.external_id=any($3::text[]))
          and m.created_at<=(select max(created_at) from messages where organization_id=$1 and conversation_id=$2 and external_id=any($3::text[]))
          and (m.sender='customer' or m.status='sent')
          order by m.created_at desc,m.id desc limit 60`,
        [org, conversation.id, parts.map(p=>p.id)],
      )
    ).rows.reverse();
    return {
      organization_id: org,
      account,
      contact,
      conversation,
      revision,
      memories,
      // History may span the customer's accounts; expose only this conversation
      // to the validator until explicit cross-account history is supported.
      history: history.filter(m=>m.conversation_id===conversation.id),
    };
  }
  async claim(c: Context, e: Incoming) {
    return (
      (
        await pool.query(
          "insert into processing_events(organization_id,conversation_id,external_id,state) values($1,$2,$3,'processing') on conflict do nothing returning external_id",
          [c.organization_id, c.conversation.id, e.id],
        )
      ).rowCount === 1
    );
  }
  async finalize(c:Context,e:Incoming,answer:string|null,send:()=>Promise<string>,options:{handoff?:boolean;calendar?:boolean}={}){
    return withChatPrivacy(c.organization_id,c.account.id,e.jid,()=>this.finalizeAllowed(c,e,answer,send,options));
  }
  private async finalizeAllowed(
    c: Context,
    e: Incoming,
    answer: string | null,
    send: () => Promise<string>,
    options:{handoff?:boolean;calendar?:boolean}={},
  ) {
    const db = await pool.connect();
    let attempted = false;
    try {
      await db.query("begin");
      // Serialize delivery with staff takeover, publishing and session changes.
      const account = (
        await db.query(
          // Credential writes take FK KEY SHARE locks during socket.sendMessage.
          // NO KEY UPDATE still serializes status changes without blocking those writes.
          "select * from whatsapp_accounts where organization_id=$1 and id=$2 for no key update",
          [c.organization_id, c.account.id],
        )
      ).rows[0];
      const conversation = (
        await db.query(
          "select * from conversations where organization_id=$1 and id=$2 for update",
          [c.organization_id, c.conversation.id],
        )
      ).rows[0];
      const contact = (
        await db.query(
          "select * from contacts where organization_id=$1 and id=$2 for update",
          [c.organization_id, c.contact.id],
        )
      ).rows[0];
      const pub = (
        await db.query(
          "select * from knowledge_publications where organization_id=$1 for share",
          [c.organization_id],
        )
      ).rows[0];
      if (!account || !conversation || !contact)
        throw new TenantMismatch("Missing delivery context");
      validateContext(
        { ...c, account, conversation, contact },
        c.account.session_id,
      );
      if (account.authenticated_jid !== c.account.authenticated_jid)
        throw new TenantMismatch("Authenticated account changed");
      const policy=(await db.query('select reply_only_when_away from organizations where id=$1',[c.organization_id])).rows[0];
      const handled=(await db.query('select 1 from whatsapp_inbox where organization_id=$1 and account_id=$2 and external_id=any($3::text[]) and owner_handled_at is not null limit 1',[c.organization_id,c.account.id,(e.parts||[e]).map(p=>p.id)])).rows[0];
      if(handled || (policy?.reply_only_when_away && account.owner_availability!=='away'))throw new OwnerDeferred('Owner is active, status unknown, or messages were handled');
      const newer=(await db.query("select 1 from whatsapp_inbox where organization_id=$1 and account_id=$2 and customer_jid=$3 and state='pending' limit 1",[c.organization_id,c.account.id,c.contact.identity])).rows.length>0;
      if (
        newer ||
        !answer ||
        conversation.mode !== "active" ||
        contact.ai_opt_out ||
        (pub?.revision_id || DEFAULT_REVISION_ID) !== c.revision.id
      ) {
        await db.query(
          "update processing_events set state='escalated' where organization_id=$1 and conversation_id=$2 and external_id=$3",
          [c.organization_id, c.conversation.id, e.id],
        );
      } else {
        attempted = true;
        const id = await send();
        await db.query(
          "insert into messages(organization_id,conversation_id,external_id,sender,content,status,ai_context_source) values($1,$2,$3,'ai',$4,'sent',$5)",
          [c.organization_id, c.conversation.id, id, answer,options.calendar?'calendar':'assistant'],
        );
        if(options.handoff){
          await db.query("update conversations set mode='human' where organization_id=$1 and id=$2",[c.organization_id,c.conversation.id]);
          await db.query("insert into audit_logs(organization_id,event,resource_id) values($1,'ai_staff_handoff',$2)",[c.organization_id,c.conversation.id]);
          await db.query(`insert into handoff_unread_requests(organization_id,conversation_id,account_id,customer_jid,message_id,message_at)
            select m.organization_id,m.conversation_id,$3,$4,m.external_id,coalesce(i.message_at,m.created_at)
            from messages m left join whatsapp_inbox i on i.organization_id=m.organization_id and i.account_id=$3 and i.external_id=m.external_id
            where m.organization_id=$1 and m.conversation_id=$2 and m.sender='customer' and m.external_id=any($5::text[])
            order by coalesce(i.message_at,m.created_at) desc,m.id desc limit 1
            on conflict(conversation_id) do update set message_id=excluded.message_id,message_at=excluded.message_at,created_at=now()`,[c.organization_id,c.conversation.id,c.account.id,c.contact.identity,(e.parts||[e]).map(p=>p.id)]);

        }
        await db.query(
          "update processing_events set state='sent' where organization_id=$1 and conversation_id=$2 and external_id=$3",
          [c.organization_id, c.conversation.id, e.id],
        );
      }
      await db.query("commit");
    } catch (error) {
      await db.query("rollback");
      if(error instanceof OwnerDeferred && !attempted)await db.query("delete from processing_events where organization_id=$1 and conversation_id=$2 and external_id=$3 and state='processing'",[c.organization_id,c.conversation.id,e.id]);
      // Never automatically retry an ambiguous external send.
      if(attempted&&options.handoff)await pool.query("update conversations set mode='human' where organization_id=$1 and id=$2 and mode='active'",[c.organization_id,c.conversation.id]);
      if (attempted)
        await pool.query(
          "update processing_events set state='uncertain' where organization_id=$1 and conversation_id=$2 and external_id=$3",
          [c.organization_id, c.conversation.id, e.id],
        );
      throw error;
    } finally {
      db.release();
    }
  }
  async security(session: string) {
    await audit(null, "tenant_validation_failed", session);
  }
}

function earliest(e:Incoming){const values=(e.parts||[e]).map(p=>p.timestamp).filter((v):v is number=>typeof v==='number');return values.length?Math.min(...values):undefined;}
