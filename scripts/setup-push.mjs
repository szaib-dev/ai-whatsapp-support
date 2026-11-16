import 'dotenv/config';
import {generateVAPIDKeys} from 'web-push';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const filename=process.argv[2]||'.env';
let content=existsSync(filename)?readFileSync(filename,'utf8'):'';
const hasPublic=/^VAPID_PUBLIC_KEY=.+/m.test(content),hasPrivate=/^VAPID_PRIVATE_KEY=.+/m.test(content);
if(hasPublic&&hasPrivate){console.log('VAPID keys already exist; kept unchanged.');process.exit(0);}
if(hasPublic||hasPrivate)throw Error('Incomplete VAPID key pair. Restore the matching pair before setup; existing keys were not rotated.');
content=content.split(/\r?\n/).filter(line=>!/^VAPID_(PUBLIC_KEY|PRIVATE_KEY|SUBJECT)=/.test(line)).join('\n');
const keys=generateVAPIDKeys();
const subject=process.env.VAPID_SUBJECT||(process.env.SUPPORT_EMAIL?'mailto:'+process.env.SUPPORT_EMAIL:'https://codetic.netawaz.pk');
content+='\n# Browser Web Push identity. Keep the private key secret and stable across deployments.\n'+
 `VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=${subject}\n`;
writeFileSync(filename,content,{mode:0o600});
console.log('Generated VAPID configuration in '+filename+'. No keys were printed. Restart the API to load it.');
