import {createClient} from '@supabase/supabase-js';
const shared=globalThis as typeof globalThis & {codeticBrowserAuth?:ReturnType<typeof createClient>};
export function getBrowserAuth(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 if(!url||!key)return null;
 if(typeof window==='undefined')return null;
 return shared.codeticBrowserAuth??=createClient(url,key);
}
