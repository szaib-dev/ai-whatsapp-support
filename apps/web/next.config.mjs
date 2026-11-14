import path from 'node:path';import {fileURLToPath} from 'node:url';
const api=(process.env.API_INTERNAL_URL||'http://127.0.0.1:3101').replace(/\/$/,'');
for(const name of ['NEXT_PUBLIC_SUPABASE_ANON_KEY']){const value=process.env[name]||'';let role='';try{role=JSON.parse(Buffer.from(value.split('.')[1]||'','base64url').toString()).role}catch{}if(value.startsWith('sb_secret_')||role==='service_role')throw Error(`${name} cannot contain a server/service-role secret`);}
export default {
 output:'standalone',outputFileTracingRoot:path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),poweredByHeader:false,
 async rewrites(){return [{source:'/calendar/:path*',destination:`${api}/calendar/:path*`}];},
 async headers(){return [{source:'/:path*',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},{key:'X-Frame-Options',value:'DENY'}]},...['/admin/:path*','/status/:path*','/calendar/:path*'].map(source=>({source,headers:[{key:'X-Robots-Tag',value:'noindex, nofollow'},{key:'Cache-Control',value:'no-store'}]}))];}
};
