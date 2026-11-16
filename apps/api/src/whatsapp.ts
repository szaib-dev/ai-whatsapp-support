import {reserveOutbound,isGeneratedMessage,recordOwnerMessage} from './owner-handover.js';
import {privacyGate,withChatPrivacy,isChatStopped,phoneFromJid,rememberPhone,assertPrivacyLease} from './chat-privacy.js';
import {ownerHandled,messageTime} from "./owner-availability.js";
import {AppointmentAssistant} from "./appointments.js";
import makeWASocket, { DisconnectReason, generateMessageIDV2, jidNormalizedUser, normalizeMessageContent, type WASocket } from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import pino from "pino";
import type { PoolClient } from "pg";
import { pool, audit } from "./db.js";
import { encryptedAuth } from "./whatsapp-auth.js";
import { SessionCipher } from "./session-crypto.js";
import { MessagePipeline } from "./pipeline.js";
import { PgStore } from "./store.js";
import { DeepSeek } from "./ai.js";
import { Dispatcher, PgInbox } from "./dispatcher.js";
type Live = { org: string; account: string; session: string; socket?: WASocket; qr?: string; qrUntil?: number; retries: number; timer?: ReturnType<typeof setTimeout>; stopped: boolean; work: Promise<void>;opened:boolean;startedAt:number };
export class WhatsAppManager {
  private cipher: SessionCipher;
  private live = new Map<string, Live>();
  private pipeline = new MessagePipeline(new PgStore(), new DeepSeek(), new AppointmentAssistant());
  private inbox = new PgInbox();
  private dispatcher = new Dispatcher(this.inbox,async(session,event)=>{await this.pipeline.receive(session,event);await this.flushHandoffs();});
  private lease?: PoolClient;
  private initializing?:Promise<void>;
  private starts=new Map<string,Promise<void>>();
  private watchdog?:ReturnType<typeof setInterval>;
  private reconciling=false;
  private markingUnread=false;
  private recovery?: ReturnType<typeof setTimeout>;
  private closing = false;
  private generatedIds = new Set<string>();
  private repliedAt = new Map<string,number>();
  private activityTimers = new Set<ReturnType<typeof setTimeout>>();
  get ready() { return !!this.lease && !this.closing; }
  constructor(key: string) { this.cipher = new SessionCipher(key); }
  async initialize() {
    if(this.closing||this.lease)return;
    if(this.initializing)return this.initializing;
    this.initializing=this.restore().finally(()=>{this.initializing=undefined});return this.initializing;
  }
  private async restore() {
    const lease = await pool.connect();
    lease.on("error", () => this.leaseLost(lease));
    try {
      if (!(await lease.query("select pg_try_advisory_lock(678123901) as locked")).rows[0].locked) throw new Error("Another WhatsApp manager is running");
    } catch (e) { lease.release(true); throw e; }
    this.lease = lease;
    await this.inbox.recover();
    await pool.query("update whatsapp_accounts a set status='disconnected' where status in ('connected','connecting','reconnecting') and not exists(select 1 from whatsapp_auth s where s.organization_id=a.organization_id and s.account_id=a.id)");
    const rows = (await pool.query("select distinct a.* from whatsapp_accounts a join whatsapp_auth s on s.organization_id=a.organization_id and s.account_id=a.id where a.removed_at is null and a.desired_connected and not a.needs_pairing and (a.reconnect_after is null or a.reconnect_after<=now())")).rows;
    for (const row of rows) {
      try{await this.start(row.organization_id,row.id,true)}catch{console.warn('Account restore deferred',{account:row.id});}
    }
    this.dispatcher.start();
    clearInterval(this.watchdog);this.watchdog=setInterval(()=>{void this.reconcile();void this.flushHandoffs();},15000);this.watchdog.unref();
  }
  private async reconcile(){
    if(this.closing||!this.lease||this.reconciling)return;this.reconciling=true;
    try{
      const rows=(await pool.query("select distinct a.* from whatsapp_accounts a join whatsapp_auth s on s.organization_id=a.organization_id and s.account_id=a.id where a.removed_at is null and a.desired_connected and not a.needs_pairing and (a.reconnect_after is null or a.reconnect_after<=now())")).rows;
      for(const row of rows){const live=this.live.get(row.id);if(live&&!live.stopped){if(!live.opened&&Date.now()-live.startedAt>120000)await this.fail(live);continue;}
        try{await this.start(row.organization_id,row.id,true)}catch{/* The next per-account recovery window retries without touching other sockets. */}
      }
    }catch{/* A temporary DB failure does not tear down unrelated live transports. */}finally{this.reconciling=false}
  }
  async ensureConnected(org:string,account:string){
    const found=await pool.query("update whatsapp_accounts set desired_connected=true,needs_pairing=false,reconnect_after=null where organization_id=$1 and id=$2 and removed_at is null returning id",[org,account]);
    if(!found.rowCount)throw Error('Unknown account');
    if(!this.ready){this.recover();return;}
    const live=this.live.get(account);if(live&&live.org!==org)throw Error('Tenant mismatch');
    // Repeated UI requests never restart a healthy or already-pairing socket.
    if(live&&!live.stopped)return;
    await this.start(org,account);
  }
  private async flushHandoffs(){
    if(this.closing||!this.ready||this.markingUnread)return;this.markingUnread=true;
    try{
      const rows=(await pool.query(`select h.* from handoff_unread_requests h
        join conversations c on c.organization_id=h.organization_id and c.id=h.conversation_id
        join whatsapp_accounts a on a.organization_id=h.organization_id and a.id=h.account_id
        where not chat_is_stopped(h.organization_id,h.account_id,h.customer_jid) and c.mode='human' and a.removed_at is null and h.account_id=any($1::uuid[]) order by h.created_at limit 100`,[[...this.live.values()].filter(l=>l.opened&&!l.stopped).map(l=>l.account)])).rows;
      for(const h of rows){
        const live=this.live.get(h.account_id);if(!live||live.org!==h.organization_id||live.stopped||!live.opened||!live.socket)continue;
        try{
          await live.socket.chatModify({markRead:false,lastMessages:[{key:{remoteJid:h.customer_jid,fromMe:false,id:h.message_id},messageTimestamp:Math.floor(new Date(h.message_at).getTime()/1000)}]},h.customer_jid);
          await pool.query('delete from handoff_unread_requests where organization_id=$1 and conversation_id=$2 and message_id=$3 and created_at=$4',[h.organization_id,h.conversation_id,h.message_id,h.created_at]);
        }catch{console.warn('Handoff unread marker deferred',{account:h.account_id});}
      }
    }catch{/* Persisted markers retry independently; the handoff message is never resent. */}finally{this.markingUnread=false}
  }
  private leaseLost(lease: PoolClient) {
    if (this.lease !== lease) return;
    this.lease = undefined;
    void this.dispatcher.close();
    for (const l of this.live.values()) { l.stopped = true; clearTimeout(l.timer); this.pipeline.unbind(l.session); l.socket?.end(new Error("Database connection interrupted")); }
    this.live.clear();
    lease.release(true);
    this.recover();
  }
  recover() {
    if (this.closing || this.recovery) return;
    if (this.lease) { this.leaseLost(this.lease); return; }
    this.recovery = setTimeout(() => {
      this.recovery = undefined;
      void this.initialize().catch(() => {
        const lease = this.lease;
        if (lease) this.leaseLost(lease);
        else this.recover();
      });
    }, 3000);
  }
  async start(org:string,account:string,automatic=false){
    const key=org+'/'+account;const pending=this.starts.get(key);if(pending)return pending;
    const work=this.startAccount(org,account,automatic);this.starts.set(key,work);try{await work}finally{this.starts.delete(key)}
  }
  private async startAccount(org: string, account: string,automatic=false) {
    if (!this.lease) throw new Error("WhatsApp manager unavailable");
    const existing=this.live.get(account);if(existing){if(existing.org!==org)throw Error('Tenant mismatch');return;}
    const row = (await pool.query("select session_id from whatsapp_accounts where organization_id=$1 and id=$2", [org, account])).rows[0];
    if (!row) throw new Error("Unknown account");
    const l: Live = { org, account, session: row.session_id, retries: 0, stopped: false, work: Promise.resolve(),opened:false,startedAt:Date.now() };
    this.live.set(account, l);
    try { const intent=await pool.query("update whatsapp_accounts set desired_connected=true,needs_pairing=false,reconnect_after=null,last_connection_error=null where organization_id=$1 and id=$2 and removed_at is null and (not $3::boolean or (desired_connected and not needs_pairing)) returning id",[org,account,automatic]);if(!intent.rowCount){l.stopped=true;this.live.delete(account);return;}await this.connect(l); } catch { await this.fail(l); throw new Error("WhatsApp connection failed"); }
  }
  private async status(l: Live, status: string) {
    await pool.query("update whatsapp_accounts set status=$3 where organization_id=$1 and id=$2 and session_id=$4", [l.org, l.account, status, l.session]);
  }
  private async fail(l: Live,terminal=false) {
    l.stopped = true; l.qr = undefined; clearTimeout(l.timer);
    this.pipeline.unbind(l.session); l.socket?.end(new Error("Connection stopped"));
    this.live.delete(l.account);
    await pool.query("update whatsapp_accounts set status='disconnected',needs_pairing=$3,reconnect_after=case when $3 then null else now()+interval '30 seconds' end,last_connection_error=$4 where organization_id=$1 and id=$2",[l.org,l.account,terminal,terminal?'WhatsApp authorization ended. Link this device again.':'Connection interrupted. Automatic retry is scheduled.']).catch(()=>{});
    await audit(l.org, "whatsapp_connection_failed", l.account).catch(() => {});
  }
  private async connect(l: Live) {
    l.opened=false;l.startedAt=Date.now();
    await this.status(l, "connecting");
    const auth = await encryptedAuth(l.org, l.account, this.cipher);
    if (l.stopped) return;
    const socket = makeWASocket({ auth: auth.state, logger: pino({ level: "silent" }), markOnlineOnConnect: false, syncFullHistory: false, shouldSyncHistoryMessage: () => false,connectTimeoutMs:30000,keepAliveIntervalMs:20000,defaultQueryTimeoutMs:15000 });
    l.socket = socket;
    // Connection/credential failures stop the socket; a single message failure must not disconnect it.
    const enqueue = (fn: () => Promise<void>, fatal = true) => {
      l.work = l.work.then(async () => { if (!l.stopped && l.socket === socket) await fn(); }).catch(async (error) => {
        console.error("WhatsApp event failed", { name: error?.name, code: error?.code, location: error?.stack?.split("\n").slice(1, 3).join("\n") });
        if (fatal) await this.fail(l);
      }).catch(() => {});
    };
    this.ownerSignals(l,socket,enqueue);
    socket.ev.on("creds.update", () => enqueue(auth.save));
    socket.ev.on("connection.update", update => enqueue(async () => {
      if (update.qr) { l.qr = await QRCode.toDataURL(update.qr); l.qrUntil = Date.now() + 55000; }
      if (update.connection === "open") {
        await auth.save(); await auth.flush();
        const jid = jidNormalizedUser(socket.user?.id || "");
        if (!jid) throw new Error("Missing authenticated identity");
        const result = await pool.query("update whatsapp_accounts set authenticated_jid=$4,status='connected' where organization_id=$1 and id=$2 and session_id=$3 and (authenticated_jid is null or authenticated_jid=$4) returning id", [l.org, l.account, l.session, jid]);
        if (result.rowCount !== 1) throw new Error("Identity mismatch");
        await this.pipeline.bind(l.session, jid, { send: async (target, text) => {
          if (l.stopped || l.socket !== socket) throw new Error("Stale connection");
          const id = generateMessageIDV2(socket.user?.id);
          this.generatedIds.add(`${l.org}/${l.account}/${id}`);if(this.generatedIds.size>2000)this.generatedIds.delete(this.generatedIds.values().next().value!);
          await reserveOutbound(l.org,l.account,target,id);
          const sent = await withChatPrivacy(l.org,l.account,target,()=>socket.sendMessage(target, { text }, { messageId: id }));
          if (!sent?.key.id) throw new Error("Uncertain send");
          this.repliedAt.set(`${l.session}/${target}`,Date.now());
          void socket.sendPresenceUpdate('paused',target).catch(()=>{});
          return sent.key.id;
        }});
        l.opened=true;void this.flushHandoffs();l.qr = undefined; l.retries = 0;
        await pool.query('update whatsapp_accounts set last_connection_error=null,needs_pairing=false,reconnect_after=null where organization_id=$1 and id=$2',[l.org,l.account]);
        await audit(l.org, "whatsapp_connected", l.account);
      }
      if (update.connection === "close") {
        l.opened=false;l.qr = undefined; this.pipeline.unbind(l.session);
        const code = (update.lastDisconnect?.error as any)?.output?.statusCode;
        console.info("WhatsApp transport closed", { code: code || "UNKNOWN", attempt: l.retries });
        if ([DisconnectReason.loggedOut, DisconnectReason.badSession].includes(code)) {
          await auth.flush();
          await pool.query("delete from whatsapp_auth where organization_id=$1 and account_id=$2", [l.org, l.account]);
        }
        if ([DisconnectReason.loggedOut, DisconnectReason.badSession, DisconnectReason.connectionReplaced, DisconnectReason.forbidden].includes(code)) { await this.fail(l,true); return; }
        if(l.retries>=5){await this.fail(l);return;}
        await this.status(l, "reconnecting");
        const attempt = l.retries++;
        const delay = code === DisconnectReason.restartRequired ? 1000 : Math.min(30000, 1000 * 2 ** attempt);
        l.timer = setTimeout(() => { if (!l.stopped) void this.connect(l).catch(() => this.fail(l)); }, delay);
      }
    }));
    socket.ev.on("messages.upsert", event => {
      enqueue(async () => {
      for (const message of event.messages) {
        const jid=message.key.remoteJid||'';
        if(!message.key.id||!/^.+@(s\.whatsapp\.net|lid)$/.test(jid))continue;
        // Inspect routing metadata only. Never normalize/read a stopped message body.
        await privacyGate(l.org,false,async()=>{
          const alternate=message.key.remoteJidAlt||'';
          let phone=phoneFromJid(jid)||phoneFromJid(alternate);
          if(!phone&&jid.endsWith('@lid'))phone=phoneFromJid(await socket.signalRepository?.lidMapping?.getPNForLID(jid)||'');
          if(phone){await rememberPhone(l.org,l.account,jid,phone);if(alternate.endsWith('@lid'))await rememberPhone(l.org,l.account,alternate,phone);}
          if(await isChatStopped(l.org,l.account,jid,messageTime(message.messageTimestamp).getTime()))return;
          assertPrivacyLease();
          if(message.key.fromMe){
            const time=messageTime(message.messageTimestamp);
            if(!this.generatedIds.has(`${l.org}/${l.account}/${message.key.id}`)&&message.messageTimestamp){
              const ours=await isGeneratedMessage(l.org,l.account,jid,message.key.id!);
              if(!ours){
                const content=normalizeMessageContent(message.message);
                const text=content?.conversation||content?.extendedTextMessage?.text||'[WhatsApp attachment]';
                // Only live outgoing events may pause. Replay is recorded/deduplicated separately.
                if(event.type==='notify')await recordOwnerMessage(l.org,l.account,jid,message.key.id!,time,text);
                await ownerHandled(l.org,l.account,jid,time);
              }
            }
            return;
          }
          if(event.type!=='notify')return;
          const content=normalizeMessageContent(message.message);
          const text=content?.conversation||content?.extendedTextMessage?.text||content?.imageMessage?.caption||content?.videoMessage?.caption||(content?.audioMessage||content?.imageMessage||content?.videoMessage||content?.documentMessage||content?.stickerMessage?'[The customer sent an attachment. Ask them to describe what they need in text.]':'');
          if(text){this.customerActivity(l,socket,message);await this.inbox.save(l.session,{id:message.key.id!,jid,text,name:message.pushName?.slice(0,120),timestamp:messageTime(message.messageTimestamp).getTime()});}
        });
      }
    }, false);
    });
  }
  private ownerSignals(l:Live,socket:WASocket,enqueue:(fn:()=>Promise<void>,fatal?:boolean)=>void){
    socket.ev.on('messages.update',updates=>enqueue(async()=>{
      for(const {key,update} of updates){if(key.fromMe===false&&key.id&&key.remoteJid&&Number(update.status)>=4)await withChatPrivacy(l.org,l.account,key.remoteJid,()=>ownerHandled(l.org,l.account,key.remoteJid!,new Date(),key.id!))}
    },false));
    socket.ev.on('chats.update',updates=>enqueue(async()=>{
      for(const chat of updates){if(chat.unreadCount===0&&chat.id&&/^.+@(s\.whatsapp\.net|lid)$/.test(chat.id))await withChatPrivacy(l.org,l.account,chat.id,()=>ownerHandled(l.org,l.account,chat.id!,messageTime(chat.timestamp||chat.conversationTimestamp)));}
    },false));
  }
  private customerActivity(l: Live, socket: WASocket, message: any) {
    const jid=message.key.remoteJid as string;
    const receivedAt=Date.now();
    const timer=setTimeout(()=>{
      this.activityTimers.delete(timer);
      void withChatPrivacy(l.org,l.account,jid,async()=>{
        if(l.stopped||l.socket!==socket)return;
        // Receipts and presence are best effort; they never block message persistence.
        const result=await pool.query(`select o.reply_only_when_away from whatsapp_accounts a join organizations o on o.id=a.organization_id
          where a.organization_id=$1 and a.id=$2 and a.status='connected' and a.removed_at is null and (not o.reply_only_when_away or a.owner_availability='away')
          and coalesce((select (r.content->>'aiEnabled')::boolean from knowledge_publications p join knowledge_revisions r on r.organization_id=p.organization_id and r.id=p.revision_id where p.organization_id=a.organization_id),true)
          and not exists(select 1 from contacts t join conversations c on c.organization_id=t.organization_id and c.contact_id=t.id where t.organization_id=a.organization_id and t.identity=$3 and c.account_id=a.id and (t.ai_opt_out or c.mode<>'active'))`,[l.org,l.account,jid]);
        if(!result.rowCount||l.stopped||l.socket!==socket||(this.repliedAt.get(`${l.session}/${jid}`)||0)>=receivedAt)return;
        if(!result.rows[0]?.reply_only_when_away)await socket.readMessages([message.key]).catch(()=>{});
        await socket.presenceSubscribe(jid).catch(()=>{});
        await socket.sendPresenceUpdate('composing',jid).catch(()=>{});
        const end=setTimeout(()=>{this.activityTimers.delete(end);if(!l.stopped&&l.socket===socket)void socket.sendPresenceUpdate('paused',jid).catch(()=>{});},15000);
        end.unref();this.activityTimers.add(end);
      }).catch(()=>{});
    },1000);timer.unref();this.activityTimers.add(timer);
  }
  qr(org: string, account: string) {
    const l = this.live.get(account);
    return l?.org === org && (l.qrUntil || 0) > Date.now() ? l.qr || null : null;
  }
  state(org: string, account: string, stored: string) {
    const l = this.live.get(account);
    if (l?.org === org && !l.stopped) return this.qr(org, account) ? "awaiting_scan" : liveConnectionState(l.opened,stored);
    return ["connecting", "reconnecting", "connected"].includes(stored) ? "disconnected" : stored;
  }
  async unlink(org: string, account: string) {
    const live = this.live.get(account);
    if (live && live.org !== org) throw new Error("Tenant mismatch");
    // Stop dispatch before logout so logout events cannot restart this socket.
    if (live) { live.stopped = true; clearTimeout(live.timer); this.pipeline.unbind(live.session); }
    try { if (live?.socket) await live.socket.logout(); }
    finally { await this.stop(org, account); await pool.query("delete from whatsapp_auth where organization_id=$1 and account_id=$2", [org, account]); }
  }
  async sendStaff(org: string, account: string, jid: string, text: string, messageId: string) {
    const live = this.live.get(account);
    if (!live || live.org !== org || live.stopped || !live.socket) throw new Error("WhatsApp is disconnected");
    this.generatedIds.add(`${org}/${account}/${messageId}`);
    await reserveOutbound(org,account,jid,messageId);
    const sent = await withChatPrivacy(org,account,jid,()=>live.socket!.sendMessage(jid, { text }, { messageId }));
    if (!sent?.key.id) throw new Error("Delivery uncertain");
    return sent.key.id;
  }
  async stop(org: string, account: string) {
    const l = this.live.get(account);
    if (l && l.org !== org) throw new Error("Tenant mismatch");
    if (l) { l.stopped = true; clearTimeout(l.timer); l.qr = undefined; this.pipeline.unbind(l.session); l.socket?.end(new Error("Disconnected by owner")); await l.work; this.live.delete(account); }
    await pool.query("update whatsapp_accounts set status='disconnected',desired_connected=false,reconnect_after=null where organization_id=$1 and id=$2", [org, account]);
  }
  async close() {
    for(const timer of this.activityTimers)clearTimeout(timer);this.activityTimers.clear();
    clearInterval(this.watchdog);
    this.closing = true; clearTimeout(this.recovery);
    await this.dispatcher.close();
    for (const l of this.live.values()) { l.stopped = true; clearTimeout(l.timer); this.pipeline.unbind(l.session); l.socket?.end(new Error("Server stopping")); await l.work; }
    this.live.clear();
    if (this.lease) { const lease = this.lease; this.lease = undefined; try { await lease.query("select pg_advisory_unlock(678123901)"); } finally { lease.release(true); } }
  }
}

function liveConnectionState(opened:boolean,stored:string){return !opened&&stored==='connected'?'connecting':stored;}
