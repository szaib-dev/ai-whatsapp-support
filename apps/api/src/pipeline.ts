import {explicitHandoff} from './conversation.js';
import type {AppointmentHandler} from "./appointments.js";
import {
  automaticResponse,
  validateContext,
  TenantMismatch,
  type Context,
  type Selector,
} from "./ai.js";
export interface Incoming {
  id: string;
  text: string;
  jid: string;
  fromMe?: boolean;
  isGroup?: boolean;
  parts?: Incoming[];
  timestamp?: number;
}
export interface SessionBinding {
  session: string;
  organization: string;
  account: string;
  authenticatedJid: string;
}
export interface Store {
  resolve(session: string): Promise<SessionBinding>;
  guard(binding:SessionBinding,event:Incoming,work:()=>Promise<void>):Promise<unknown>;
  load(binding: SessionBinding, event: Incoming): Promise<Context | null>;
  claim(c: Context, event: Incoming): Promise<boolean>;
  finalize(
    c: Context,
    event: Incoming,
    answer: string | null,
    send: () => Promise<string>,
    options?:{handoff?:boolean;calendar?:boolean},
  ): Promise<void>;
  security(session: string): Promise<void>;
}
export interface Transport {
  send(jid: string, text: string): Promise<string>;
}
export class MessagePipeline {
  private sockets = new Map<
    string,
    { binding: SessionBinding; transport: Transport }
  >();
  private pending = new Map<string, Promise<void>>();
  constructor(
    private store: Store,
    private ai: Selector,
    private appointments?: AppointmentHandler,
  ) {}
  // Called by trusted transport code after authentication; never exposed as an HTTP endpoint.
  async bind(session: string, authenticatedJid: string, transport: Transport) {
    if (this.sockets.has(session)) throw new Error("Duplicate socket");
    const binding = await this.store.resolve(session);
    if (binding.authenticatedJid !== authenticatedJid) {
      await this.store.security(session);
      throw new TenantMismatch("Account authentication mismatch");
    }
    this.sockets.set(session, {
      binding: Object.freeze({ ...binding }),
      transport,
    });
  }
  unbind(session: string) {
    this.sockets.delete(session);
  }
  async receive(session: string, event: Incoming) {
    if (
      event.fromMe ||
      event.isGroup ||
      !event.text.trim() ||
      !/^.+@(s\.whatsapp\.net|lid)$/.test(event.jid) ||
      event.text.length > 8000
    )
      return;
    if (this.pending.size >= 100) throw new Error("Queue full");
    const key = `${session}:${event.jid}`;
    const previous = this.pending.get(key) ?? Promise.resolve();
    const work = previous
      .catch(() => {})
      .then(() => this.process(session, event));
    this.pending.set(key, work);
    try {
      await work;
    } finally {
      if (this.pending.get(key) === work) this.pending.delete(key);
    }
  }
  private async process(session: string, event: Incoming) {
    const socket = this.sockets.get(session);
    if (!socket) throw new Error("Unauthenticated session");
    let finalized = false;
    try {
      const current = await this.store.resolve(session);
      if (JSON.stringify(current) !== JSON.stringify(socket.binding))
        throw new TenantMismatch("Session binding changed");
      const work=async()=>{
        const c = await this.store.load(current, event);
        if (!c) return;
        validateContext(c, session);
        if (!(await this.store.claim(c, event))) return;
        let answer: string | null = null;
        let handoff=false,calendar=false;
        if (
          c.conversation.mode === "active" &&
          !c.contact.ai_opt_out &&
          c.revision.content.aiEnabled
        ) {
          try {
            answer = explicitHandoff(event.text)?null:await this.appointments?.reply(c,event.text,event.id) ?? null;
            calendar=answer!==null;
            if(answer===null){const decision=await automaticResponse(c,event.text,this.ai);answer=decision.reply;handoff=decision.handoff;}
          } catch {
            answer = null;
          }
        }
        finalized = true;
        await this.store.finalize(c, event, answer, async () => {
          if (this.sockets.get(session) !== socket)
            throw new TenantMismatch("Socket changed");
          return socket.transport.send(c.contact.identity, answer!);
        },{handoff,calendar});
      };
      await this.store.guard(current,event,work);
    } catch (error) {
      if (error instanceof TenantMismatch) await this.store.security(session);
      if (!finalized && error instanceof Error && !(error instanceof TenantMismatch)) Object.assign(error, { safeToRetry: true });
      throw error;
    }
  }
}
