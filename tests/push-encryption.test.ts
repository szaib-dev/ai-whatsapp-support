import {it,expect} from 'vitest';
import {createECDH,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {generateRequestDetails,generateVAPIDKeys} from 'web-push';
const ece=createRequire(import.meta.url)('http_ece');
it('generates signed VAPID requests with payloads decryptable only by the subscribed device',async()=>{
 const receiver=createECDH('prime256v1');receiver.generateKeys();const auth=randomBytes(16);
 const subscription={endpoint:'https://fcm.googleapis.com/wp/synthetic',keys:{p256dh:receiver.getPublicKey().toString('base64url'),auth:auth.toString('base64url')}};
 const payload=JSON.stringify({id:'event',body:'Private notification preview'}),keys=generateVAPIDKeys();
 const request=await generateRequestDetails(subscription,payload,{vapidDetails:{...keys,subject:'mailto:test@example.com'},TTL:3600,contentEncoding:'aes128gcm'});
 expect(request.headers.Authorization).toContain('vapid');expect(request.headers['Content-Encoding']).toBe('aes128gcm');
 expect(Buffer.from(request.body!).toString()).not.toContain('Private notification preview');
 const decoded=ece.decrypt(Buffer.from(request.body!),{version:'aes128gcm',privateKey:receiver,authSecret:auth});
 expect(decoded.toString()).toBe(payload);
 const stranger=createECDH('prime256v1');stranger.generateKeys();
 expect(()=>ece.decrypt(Buffer.from(request.body!),{version:'aes128gcm',privateKey:stranger,authSecret:auth})).toThrow();
});
