import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
const owner = vi.hoisted(()=>({record:vi.fn(async()=>{}),generated:vi.fn(async()=>false)}));
vi.mock("../apps/api/src/owner-handover.js",()=>({recordOwnerMessage:owner.record,isGeneratedMessage:owner.generated,reserveOutbound:async()=>{}}));
const mock = vi.hoisted(() => ({ sockets: [] as any[], dispatch:undefined as undefined|((session:string,event:any)=>Promise<void>), query: vi.fn(), bind: vi.fn(), unbind: vi.fn(), receive: vi.fn(), inboxSave: vi.fn(), save: vi.fn(), audit: vi.fn(), rejectIdentity: false, leaseError: undefined as (() => void) | undefined, release: vi.fn() }));
vi.mock("../apps/api/src/db.js", () => ({ privacyLocks:{connect:async()=>({query:async()=>({rows:[]}),on:()=>{},removeListener:()=>{},release:()=>{}})}, pool: { query: mock.query, connect: async () => ({ query: async () => ({ rows: [{ locked: true }] }), release: mock.release, on: (_name: string, handler: () => void) => { mock.leaseError = handler; } }) }, audit: mock.audit }));
vi.mock("../apps/api/src/pipeline.js", () => ({ MessagePipeline: class { bind = mock.bind; unbind = mock.unbind; receive = mock.receive; } }));
vi.mock("../apps/api/src/whatsapp-auth.js", () => ({ encryptedAuth: async () => ({ state: {}, save: mock.save, flush: async () => {} }) }));
vi.mock("qrcode", () => ({ default: { toDataURL: async (qr: string) => "data:image/png;base64," + qr } }));
vi.mock("@whiskeysockets/baileys", () => ({
  default: () => {
    const handlers: Record<string, (value: any) => void> = {};
    const socket = { ev: { on: (name: string, fn: any) => { handlers[name] = fn; } }, user: { id: "clinic@s.whatsapp.net" }, end: vi.fn(), sendMessage: vi.fn(), chatModify:vi.fn(async()=>{}), readMessages: vi.fn(async()=>{}), presenceSubscribe: vi.fn(async()=>{}), sendPresenceUpdate: vi.fn(async()=>{}), emit: (name: string, value: any) => handlers[name](value) };
    mock.sockets.push(socket); return socket;
  },
  jidNormalizedUser: (id: string) => id,
  normalizeMessageContent: (content: any) => content,
  generateMessageIDV2: () => "generated-id",
  DisconnectReason: { loggedOut: 401, badSession: 500, connectionReplaced: 440, forbidden: 403, restartRequired: 515 },
}));
vi.mock("../apps/api/src/dispatcher.js", () => ({ PgInbox: class { save = mock.inboxSave; recover = async () => {}; }, Dispatcher: class { constructor(_repo:any,deliver:any){mock.dispatch=deliver;} start() {} async close() {} } }));
import { WhatsAppManager } from "../apps/api/src/whatsapp.js";
let manager: WhatsAppManager;
beforeEach(async () => {
  vi.clearAllMocks(); mock.sockets.length = 0; mock.rejectIdentity = false;
  mock.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith("select distinct")) return { rows: [] };
    if (sql.startsWith("select session_id")) return { rows: [{ session_id: "session" }] };
    if (sql.includes("authenticated_jid=$4")) return { rows: [], rowCount: mock.rejectIdentity ? 0 : 1 };
    return { rows: [], rowCount: 1 };
  });
  manager = new WhatsAppManager(randomBytes(32).toString("base64"));
  await manager.initialize(); await manager.start("revive", "account");
});
afterEach(async () => { await manager.close(); vi.useRealTimers(); });
it("exposes a real pairing code only to the bound organization and expires it", async () => {
  mock.sockets[0].emit("connection.update", { qr: "test-code" });
  await vi.waitFor(() => expect(manager.qr("revive", "account")).toBeTruthy());
  expect(manager.qr("zorro", "account")).toBeNull();
  vi.useFakeTimers(); vi.setSystemTime(Date.now() + 60000);
  expect(manager.qr("revive", "account")).toBeNull();
});
it("binds the pipeline only after durable credentials and server identity validation", async () => {
  mock.sockets[0].emit("connection.update", { connection: "open" });
  await vi.waitFor(() => expect(mock.bind).toHaveBeenCalledWith("session", "clinic@s.whatsapp.net", expect.anything()));
  expect(mock.save).toHaveBeenCalled();
  expect(mock.query.mock.calls.find(([sql]) => sql.includes("authenticated_jid=$4"))?.[1]).toEqual(["revive", "account", "session", "clinic@s.whatsapp.net"]);
});
it("fails closed when the paired identity does not match the stored account", async () => {
  mock.rejectIdentity = true;
  mock.sockets[0].emit("connection.update", { connection: "open" });
  await vi.waitFor(() => expect(mock.sockets[0].end).toHaveBeenCalled());
  expect(mock.bind).not.toHaveBeenCalled();
});
it("backs off transient disconnects and never reconnects after logout", async () => {
  vi.useFakeTimers();
  mock.sockets[0].emit("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode: 408 } } } });
  await vi.advanceTimersByTimeAsync(1100);
  expect(mock.sockets).toHaveLength(2);
  mock.sockets[1].emit("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode: 401 } } } });
  await vi.advanceTimersByTimeAsync(60000);
  expect(mock.sockets).toHaveLength(2);
  expect(mock.unbind).toHaveBeenCalledWith("session");
});
it("routes private live text through the verified session and skips replayed history", async () => {
  const message = { key: { id: "msg", remoteJid: "customer@lid" }, message: { conversation: "Hours?" } };
  mock.sockets[0].emit("messages.upsert", { type: "append", messages: [message] });
  mock.sockets[0].emit("messages.upsert", { type: "notify", messages: [message] });
  await vi.waitFor(() => expect(mock.inboxSave).toHaveBeenCalledTimes(1));
  expect(mock.inboxSave).toHaveBeenCalledWith("session", { id: "msg", jid: "customer@lid", text: "Hours?",timestamp:expect.any(Number) });
});
it("losing the database lease closes transport, reports disconnected and recovers automatically", async () => {
  vi.useFakeTimers();
  expect(manager.ready).toBe(true);
  mock.leaseError!();
  expect(manager.ready).toBe(false);
  expect(mock.sockets[0].end).toHaveBeenCalled();
  expect(mock.release).toHaveBeenCalledWith(true);
  expect(manager.state("revive", "account", "connecting")).toBe("disconnected");
  await vi.advanceTimersByTimeAsync(3100);
  expect(manager.ready).toBe(true);
});
it("failure to write disconnected state does not retain a dead socket", async () => {
  mock.query.mockRejectedValue(new Error("database offline"));
  mock.sockets[0].emit("connection.update", { connection: "open" });
  await vi.waitFor(() => expect(mock.sockets[0].end).toHaveBeenCalled());
  expect(manager.state("revive", "account", "connected")).toBe("disconnected");
});

it("marks incoming messages read without speculative typing",async()=>{
 vi.useFakeTimers();const socket=mock.sockets[0];
 socket.emit('messages.upsert',{type:'notify',messages:[{key:{id:'read-test',remoteJid:'customer@lid'},message:{conversation:'Hello'}}]});
 await vi.advanceTimersByTimeAsync(900);expect(socket.readMessages).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(200);expect(socket.readMessages).toHaveBeenCalledWith([{id:'read-test',remoteJid:'customer@lid'}]);expect(socket.sendPresenceUpdate).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(15000);expect(socket.sendPresenceUpdate).not.toHaveBeenCalled();
});
it('uses incoming read sync only, never a customer reading our outbound message',async()=>{
 mock.query.mockImplementation(async(sql:string)=>({rows:sql.includes('select 1 from organizations')?[{}]:[],rowCount:1}));
 mock.sockets[0].emit('messages.update',[{key:{id:'owner-read',remoteJid:'customer@lid',fromMe:false},update:{status:4}}]);
 await vi.waitFor(()=>expect(mock.query.mock.calls.some(([sql])=>sql.startsWith('insert into whatsapp_owner_reads'))).toBe(true));
 const count=mock.query.mock.calls.filter(([sql])=>sql.startsWith('insert into whatsapp_owner_reads')).length;
 mock.sockets[0].emit('messages.update',[{key:{id:'customer-read-our-reply',remoteJid:'customer@lid',fromMe:true},update:{status:4}}]);
 await new Promise(r=>setTimeout(r,10));expect(mock.query.mock.calls.filter(([sql])=>sql.startsWith('insert into whatsapp_owner_reads'))).toHaveLength(count);
});
it('does not auto-read waiting messages in away-only mode',async()=>{
 vi.useFakeTimers();mock.query.mockImplementation(async(sql:string)=>({rows:sql.includes('/* chat privacy */')?[]:[{reply_only_when_away:true}],rowCount:1}));
 mock.sockets[0].emit('messages.upsert',{type:'notify',messages:[{key:{id:'waiting',remoteJid:'customer@lid'},message:{conversation:'Hello'}}]});await vi.advanceTimersByTimeAsync(1100);expect(mock.sockets[0].readMessages).not.toHaveBeenCalled();
});
it('repeated connect requests and workspace reads preserve both account transports',async()=>{
 await manager.start('other-clinic','other-account');
 const first=mock.sockets[0],second=mock.sockets[1];
 await Promise.all([manager.ensureConnected('revive','account'),manager.ensureConnected('other-clinic','other-account'),manager.ensureConnected('revive','account')]);
 for(let i=0;i<10;i++){manager.state('revive','account','connected');manager.state('other-clinic','other-account','connected');manager.qr('revive','account')}
 expect(mock.sockets).toHaveLength(2);expect(first.end).not.toHaveBeenCalled();expect(second.end).not.toHaveBeenCalled();
});
it('one account failure leaves the other clinic connected',async()=>{
 await manager.start('other-clinic','other-account');const second=mock.sockets[1];
 mock.sockets[0].emit('connection.update',{connection:'close',lastDisconnect:{error:{output:{statusCode:401}}}});
 await vi.waitFor(()=>expect(mock.sockets[0].end).toHaveBeenCalled());
 expect(second.end).not.toHaveBeenCalled();expect(manager.ready).toBe(true);
});
it('startup isolates failed account restoration and continues with healthy accounts',async()=>{
 await manager.close();const original=mock.query.getMockImplementation()!;
 mock.query.mockImplementation(async(sql:string,params?:any[])=>{
  if(sql.startsWith('select distinct'))return {rows:[{organization_id:'bad-clinic',id:'bad-account'},{organization_id:'good-clinic',id:'good-account'}]};
  if(sql.startsWith('select session_id')&&params?.[1]==='bad-account')throw Error('One account unavailable');
  return original(sql,params);
 });
 manager=new WhatsAppManager(randomBytes(32).toString('base64'));await manager.initialize();
 expect(manager.ready).toBe(true);expect(mock.sockets).toHaveLength(2);expect(mock.sockets[1].end).not.toHaveBeenCalled();
 await manager.ensureConnected('good-clinic','good-account');expect(mock.sockets).toHaveLength(2);
});
it('the watchdog restores missing eligible sessions without replacing healthy transports',async()=>{
 await manager.close();vi.useFakeTimers();const original=mock.query.getMockImplementation()!;let eligible=false;
 mock.query.mockImplementation(async(sql:string,params?:any[])=>sql.startsWith('select distinct')?{rows:eligible?[{organization_id:'clinic',id:'recover-account'}]:[]}:original(sql,params));
 manager=new WhatsAppManager(randomBytes(32).toString('base64'));await manager.initialize();eligible=true;
 await vi.advanceTimersByTimeAsync(15010);expect(mock.sockets).toHaveLength(2);const socket=mock.sockets[1];
 await vi.advanceTimersByTimeAsync(15010);expect(mock.sockets).toHaveLength(2);expect(socket.end).not.toHaveBeenCalled();
});
it('an automatic retry respects a concurrent intentional disconnect',async()=>{
 const original=mock.query.getMockImplementation()!;
 mock.query.mockImplementation(async(sql:string,params?:any[])=>sql.includes('and (not $3::boolean')&&params?.[2]?{rows:[],rowCount:0}:original(sql,params));
 await manager.start('other-clinic','stopped-account',true);
 expect(mock.sockets).toHaveLength(1);expect(manager.state('other-clinic','stopped-account','disconnected')).toBe('disconnected');
});

it('staff handoff unread markers use the correct account, retry failures and never resend the notice',async()=>{
 const socket=mock.sockets[0];socket.emit('connection.update',{connection:'open'});
 await vi.waitFor(()=>expect(mock.bind).toHaveBeenCalled());
 const created=new Date();let pending=true;const original=mock.query.getMockImplementation()!;
 mock.query.mockImplementation(async(sql:string,params?:any[])=>{
  if(sql.startsWith('select h.* from handoff_unread_requests'))return {rows:pending?[{organization_id:'revive',account_id:'account',conversation_id:'chat',customer_jid:'customer@lid',message_id:'incoming',message_at:created,created_at:created},{organization_id:'other-clinic',account_id:'account',conversation_id:'other-chat',customer_jid:'private@lid',message_id:'private',message_at:created,created_at:created}]:[]};
  if(sql.startsWith('delete from handoff_unread_requests')){pending=false;return {rows:[],rowCount:1};}return original(sql,params);
 });
 socket.chatModify.mockRejectedValueOnce(Error('Temporary connection failure'));
 await mock.dispatch!('session',{id:'event',jid:'customer@lid',text:'Staff please'});expect(pending).toBe(true);expect(socket.end).not.toHaveBeenCalled();
 await mock.dispatch!('session',{id:'next',jid:'customer@lid',text:'Follow-up'});expect(pending).toBe(false);
 expect(socket.chatModify).toHaveBeenCalledTimes(2);expect(socket.chatModify).toHaveBeenLastCalledWith({markRead:false,lastMessages:[{key:{remoteJid:'customer@lid',fromMe:false,id:'incoming'},messageTimestamp:Math.floor(created.getTime()/1000)}]},'customer@lid');expect(socket.sendMessage).not.toHaveBeenCalled();
});

it('stopped numbers are rejected from routing metadata before reading the message body or showing typing',async()=>{
 const original=mock.query.getMockImplementation()!;
 mock.query.mockImplementation(async(sql:string,params?:any[])=>sql.includes('/* chat privacy */')?{rows:[{}],rowCount:1}:original(sql,params));
 const content=vi.fn(()=>({conversation:'NEVER_READ_THIS_CONTENT'}));
 const message={key:{id:'private',remoteJid:'923001234567@s.whatsapp.net'}};
 Object.defineProperty(message,'message',{get:content});
 mock.sockets[0].emit('messages.upsert',{type:'notify',messages:[message]});
 await vi.waitFor(()=>expect(mock.query.mock.calls.some(([sql])=>sql.includes('/* chat privacy */'))).toBe(true));
 expect(content).not.toHaveBeenCalled();expect(mock.inboxSave).not.toHaveBeenCalled();expect(mock.receive).not.toHaveBeenCalled();expect(mock.sockets[0].readMessages).not.toHaveBeenCalled();expect(mock.sockets[0].sendPresenceUpdate).not.toHaveBeenCalled();
 expect(JSON.stringify(mock.query.mock.calls)).not.toContain('NEVER_READ_THIS_CONTENT');
});
it('alternate phone metadata is mapped before checking a stopped LID',async()=>{
 const original=mock.query.getMockImplementation()!;
 mock.query.mockImplementation(async(sql:string,params?:any[])=>sql.includes('/* chat privacy */')?{rows:[{}],rowCount:1}:original(sql,params));
 mock.sockets[0].emit('messages.upsert',{type:'notify',messages:[{key:{id:'alias-private',remoteJid:'123456789123@lid',remoteJidAlt:'923001234567@s.whatsapp.net'},message:{conversation:'DO_NOT_STORE'}}]});
 await vi.waitFor(()=>expect(mock.query.mock.calls.some(([sql])=>sql.includes('/* chat privacy */'))).toBe(true));
 expect(mock.query.mock.calls.find(([sql])=>sql.startsWith('insert into chat_phone_addresses'))?.[1]).toEqual(['revive','account','123456789123@lid','923001234567']);expect(mock.inboxSave).not.toHaveBeenCalled();
});
it('a privacy stop also cancels scheduled read receipts and typing',async()=>{
 vi.useFakeTimers();let stopped=false;const original=mock.query.getMockImplementation()!;
 mock.query.mockImplementation(async(sql:string,params?:any[])=>sql.includes('/* chat privacy */')?{rows:stopped?[{}]:[],rowCount:stopped?1:0}:original(sql,params));
 mock.sockets[0].emit('messages.upsert',{type:'notify',messages:[{key:{id:'before-stop',remoteJid:'923001234567@s.whatsapp.net'},message:{conversation:'Before stop'}}]});
 await vi.advanceTimersByTimeAsync(500);expect(mock.inboxSave).toHaveBeenCalled();stopped=true;await vi.advanceTimersByTimeAsync(1000);
 expect(mock.sockets[0].readMessages).not.toHaveBeenCalled();expect(mock.sockets[0].sendPresenceUpdate).not.toHaveBeenCalled();
});

it.each(['notify','append'])('owner messages delivered as %s reset takeover, but generated echoes and protocol sync do not',async(type)=>{
 const time=Math.floor(Date.now()/1000),socket=mock.sockets[0];
 const message=(id:string,content:any)=>({key:{id,remoteJid:'customer@lid',fromMe:true},messageTimestamp:time,message:content});
 socket.emit('messages.upsert',{type,messages:[message('manual-'+type,{conversation:'I am here'})]});
 await vi.waitFor(()=>expect(owner.record).toHaveBeenCalledTimes(1));
 expect(owner.record).toHaveBeenCalledWith('revive','account','customer@lid','manual-'+type,new Date(time*1000),'I am here');
 owner.generated.mockResolvedValueOnce(true);
 socket.emit('messages.upsert',{type,messages:[message('ai-echo',{conversation:'Generated'})]});
 await vi.waitFor(()=>expect(owner.generated).toHaveBeenCalledTimes(2));
 socket.emit('messages.upsert',{type,messages:[message('sync',{protocolMessage:{type:0}})]});
 await vi.waitFor(()=>expect(owner.generated).toHaveBeenCalledTimes(3));
 expect(owner.record).toHaveBeenCalledTimes(1);expect(mock.inboxSave).not.toHaveBeenCalled();
});

it('invalid outgoing timestamps cannot become a fresh manual takeover',async()=>{
 const socket=mock.sockets[0];
 for(const timestamp of [undefined,0,Number.NaN,Math.floor(Date.now()/1000)+3600])socket.emit('messages.upsert',{type:'append',messages:[{key:{id:String(timestamp),fromMe:true,remoteJid:'customer@lid'},messageTimestamp:timestamp,message:{conversation:'Invalid timestamp'}}]});
 await new Promise(resolve=>setTimeout(resolve,25));expect(owner.record).not.toHaveBeenCalled();
});

it('typing starts only for an approved outgoing response and always stops on transport failure',async()=>{
 const socket=mock.sockets[0];socket.emit('connection.update',{connection:'open'});
 await vi.waitFor(()=>expect(mock.bind).toHaveBeenCalled());
 const transport=mock.bind.mock.calls[0][2];
 socket.sendMessage.mockResolvedValueOnce({key:{id:'confirmed'}});
 await transport.send('customer@lid','A useful response');
 expect(socket.sendPresenceUpdate.mock.calls.slice(-2)).toEqual([['composing','customer@lid'],['paused','customer@lid']]);
 socket.sendMessage.mockRejectedValueOnce(Error('Transport failed'));
 await expect(transport.send('customer@lid','Another useful response')).rejects.toThrow('Transport failed');
 expect(socket.sendPresenceUpdate.mock.calls.at(-1)).toEqual(['paused','customer@lid']);
});
it('contact updates and verified LID mappings survive contact events arriving before a conversation',async()=>{
 const socket=mock.sockets[0];socket.emit('contacts.upsert',[{id:'1234567890123@lid',lid:'1234567890123@lid',phoneNumber:'923001234567@s.whatsapp.net',name:'Saved contact'}]);
 await vi.waitFor(()=>expect(mock.query.mock.calls.some(([sql])=>sql.startsWith('insert into contacts'))).toBe(true));
 expect(mock.query.mock.calls.some(([sql,args])=>sql.startsWith('insert into chat_phone_addresses')&&args[2]==='1234567890123@lid'&&args[3]==='923001234567')).toBe(true);
 socket.emit('contacts.update',[{id:'923001234568@s.whatsapp.net',notify:'Updated name'}]);
 await vi.waitFor(()=>expect(mock.query.mock.calls.some(([sql,args])=>sql.startsWith('insert into contacts')&&args[2]==='Updated name')).toBe(true));
 socket.emit('lid-mapping.update',{lid:'1234567890124@lid',pn:'923001234568@s.whatsapp.net'});
 await vi.waitFor(()=>expect(mock.query.mock.calls.some(([sql,args])=>sql.startsWith('insert into chat_phone_addresses')&&args[2]==='1234567890124@lid')).toBe(true));
});
