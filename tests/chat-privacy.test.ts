import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';
const mocked=vi.hoisted(()=>({query:vi.fn(),connect:vi.fn()}));
vi.mock('../apps/api/src/db.js',()=>({pool:{query:mocked.query},privacyLocks:{connect:mocked.connect}}));
import {phoneNumber,phoneFromJid,privacyGate,withChatPrivacy,privacySignal} from '../apps/api/src/chat-privacy.js';
function lease(){return Object.assign(new EventEmitter(),{query:vi.fn(async(_sql:string,_params?:unknown[])=>({rows:[]})),release:vi.fn()});}
beforeEach(()=>{vi.clearAllMocks();mocked.query.mockResolvedValue({rows:[]});mocked.connect.mockImplementation(async()=>lease());});
afterEach(()=>vi.restoreAllMocks());
it.each([['+92 (300) 123-4567','923001234567'],['00923001234567','923001234567'],['923001234567','923001234567'],['03001234567',null],['bad',null],['92300@lid',null],['+123',null]])('normalizes international phone inputs %s', (input,result)=>expect(phoneNumber(input)).toBe(result));
it('resolves real phone JIDs, never mistakes a LID for a phone',()=>{expect(phoneFromJid('923001234567:3@s.whatsapp.net')).toBe('923001234567');expect(phoneFromJid('923001234567@lid')).toBeNull();});
it('takes a shared privacy lease and never executes a stopped message callback',async()=>{
 const client=lease();mocked.connect.mockResolvedValue(client);mocked.query.mockResolvedValue({rows:[{}]});const work=vi.fn();
 await withChatPrivacy('clinic','account','923001234567@s.whatsapp.net',work);
 expect(work).not.toHaveBeenCalled();expect(client.query.mock.calls.map(c=>c[0])).toEqual([expect.stringContaining('pg_advisory_lock_shared'),expect.stringContaining('pg_advisory_unlock_shared')]);expect(client.release).toHaveBeenCalledWith(false);
});
it('database/privacy lookup failure fails closed instead of running AI',async()=>{
 mocked.query.mockRejectedValue(Error('DB unavailable'));const work=vi.fn();await expect(withChatPrivacy('clinic','account','person@lid',work)).rejects.toThrow();expect(work).not.toHaveBeenCalled();
});
it('destroys an ambiguously acquired lease rather than returning a possibly locked session to the pool',async()=>{
 const client=lease();client.query.mockRejectedValue(Error('Query read timeout'));mocked.connect.mockResolvedValue(client);
 const work=vi.fn();await expect(privacyGate('clinic',false,work)).rejects.toThrow('Query read timeout');
 expect(work).not.toHaveBeenCalled();expect(client.release).toHaveBeenCalledWith(true);
});
it('nested guards reuse the lease without exhausting the DB pool',async()=>{
 await privacyGate('clinic',false,()=>withChatPrivacy('clinic','account','person@lid',async()=>42));expect(mocked.connect).toHaveBeenCalledTimes(1);
});
it('delayed callbacks cannot reuse a privacy lease that has already been released',async()=>{
 let resume!:()=>void,delayed!:Promise<unknown>;
 const wait=new Promise<void>(resolve=>{resume=resolve});
 await privacyGate('clinic',false,async()=>{delayed=wait.then(()=>withChatPrivacy('clinic','account','person@lid',async()=>42));});
 expect(mocked.connect).toHaveBeenCalledTimes(1);resume();await delayed;
 expect(mocked.connect).toHaveBeenCalledTimes(2);
});
it('does not apply/confirm a stop before active processing has drained',async()=>{
 let finishWork!:()=>void,unlockReader!:()=>void;
 const workPending=new Promise<void>(r=>{finishWork=r}),readerDone=new Promise<void>(r=>{unlockReader=r});
 const reader=lease(),writer=lease();
 reader.query.mockImplementation(async(sql?:string)=>{if(sql?.includes('unlock_shared'))unlockReader();return {rows:[]};});
 writer.query.mockImplementation(async(sql?:string)=>{if(sql?.includes('pg_advisory_lock('))await readerDone;return {rows:[]};});
 mocked.connect.mockResolvedValueOnce(reader).mockResolvedValueOnce(writer);
 const running=privacyGate('clinic',false,async()=>workPending);
 await vi.waitFor(()=>expect(reader.query).toHaveBeenCalled());
 const apply=vi.fn(async()=>{}),stopping=privacyGate('clinic',true,apply);
 await vi.waitFor(()=>expect(writer.query).toHaveBeenCalled());expect(apply).not.toHaveBeenCalled();
 finishWork();await Promise.all([running,stopping]);expect(apply).toHaveBeenCalledTimes(1);
});
it('a lost privacy lease aborts provider requests and blocks subsequent work',async()=>{
 const client=lease();mocked.connect.mockResolvedValue(client);
 const next=vi.fn();let signal!:AbortSignal;
 await expect(privacyGate('clinic',false,async()=>{
  signal=privacySignal(10000);client.emit('error',Error('Connection lost'));expect(signal.aborted).toBe(true);
  await withChatPrivacy('clinic','account','person@lid',next);
 })).rejects.toThrow('Privacy lease interrupted');expect(next).not.toHaveBeenCalled();expect(client.release).toHaveBeenCalledWith(true);
});
