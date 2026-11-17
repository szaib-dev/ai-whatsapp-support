import {expect,it,vi} from 'vitest';
import {RequestCache} from '../apps/web/app/request-cache.js';
it('deduplicates concurrent reads and reuses fresh results',async()=>{const cache=new RequestCache();const load=vi.fn(async()=>({count:1}));const [a,b]=await Promise.all([cache.read('user:org',load),cache.read('user:org',load)]);expect(a).toEqual(b);await cache.read('user:org',load);expect(load).toHaveBeenCalledTimes(1)});
it('does not restore stale data after invalidation during a request',async()=>{const cache=new RequestCache();let resolve!:(v:string)=>void;const pending=cache.read('key',()=>new Promise<string>(r=>{resolve=r}));cache.clear();await cache.read('key',async()=>'new');resolve('old');await pending;expect(await cache.read('key',async()=>'wrong')).toBe('new')});
it('retries failures and isolates principals',async()=>{const cache=new RequestCache();await expect(cache.read('a',async()=>{throw Error('offline')})).rejects.toThrow('offline');expect(await cache.read('a',async()=>1)).toBe(1);expect(await cache.read('b',async()=>2)).toBe(2)});

