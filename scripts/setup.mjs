import { copyFile, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
const root=new URL('../',import.meta.url);
for(const [source,dest] of [['.env.example','.env'],['apps/web/.env.local.example','apps/web/.env.local']]){
 await mkdir(new URL('./',new URL(dest,root)),{recursive:true});
 try{await copyFile(new URL(source,root),new URL(dest,root),constants.COPYFILE_EXCL);console.log(`Created ${dest}`);}
 catch(e){if(e.code!=='EEXIST')throw e;console.log(`Preserved existing ${dest}`);}
}
console.log('Fill DATABASE_URL, SUPABASE_URL and SUPABASE_ANON_KEY in .env, and the public Supabase values in apps/web/.env.local. Never paste secrets into chat.');
