import { config } from 'dotenv';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const [major,minor]=process.versions.node.split('.').map(Number);
if(major<22||(major===22&&minor<12)){
 console.error('Codetic AI requires Node 22.12+. On this machine run:\nnpx --yes --package=node@22 --call "npm run dev"');
 process.exit(1);
}
const root=new URL('../',import.meta.url);
config({path:fileURLToPath(new URL('.env',root)),quiet:true});
const missing=['DATABASE_URL','SUPABASE_URL','SUPABASE_ANON_KEY'].filter(k=>!process.env[k]?.trim());
if(missing.length){
 console.error(`API configuration is incomplete: ${missing.join(', ')}.\nRun npm run setup, then fill the root .env with development credentials.\nTo preview the dashboard without credentials: npm run dev:web`);
 process.exit(1);
}
const child=spawn(process.execPath,[fileURLToPath(new URL('node_modules/tsx/dist/cli.mjs',root)),'watch','src/server.ts'],{cwd:fileURLToPath(new URL('apps/api/',root)),env:process.env,stdio:'inherit'});
child.on('error',()=>{console.error('Unable to start tsx. Run npm ci.');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
