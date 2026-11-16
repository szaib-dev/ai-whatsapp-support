import {spawn} from 'node:child_process';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
// Keep supervision independent of the browser, workspace selection and source-file watches.
const root=fileURLToPath(new URL('../',import.meta.url));
if(Number(process.versions.node.split('.')[0])<22)throw Error('Node 22.12+ is required');
const guard=net.createServer();
guard.on('error',()=>{console.error('An API supervisor is already running (port 3102).');process.exit(1)});
guard.listen(3102,'127.0.0.1',()=>{
 const probe=net.connect(3101,'127.0.0.1');
 probe.once('connect',()=>{probe.destroy();console.error('API port 3101 is already in use. Stop that API before starting supervision.');guard.close();process.exitCode=1});
 probe.once('error',()=>start());
});
let child,timer,stopping=false,failures=0,startedAt=0;
function start(){
 if(stopping)return;startedAt=Date.now();
 child=spawn(process.execPath,['--import','dotenv/config','--import','tsx','apps/api/src/server.ts'],{cwd:root,stdio:'inherit',windowsHide:true});
 child.once('error',error=>{console.error('API launch failed:',error.code)});
 child.once('exit',(code,signal)=>{
  if(stopping)return;
  failures=Date.now()-startedAt>60000?0:failures+1;
  const delay=Math.min(30000,1000*2**Math.min(failures,5));
  console.error(`API exited (${code??signal}); restarting in ${delay/1000}s.`);
  timer=setTimeout(start,delay);
 });
}
function stop(){if(stopping)return;stopping=true;clearTimeout(timer);guard.close();if(child&&!child.killed){child.once('exit',()=>process.exit(0));child.kill('SIGTERM');setTimeout(()=>process.exit(0),10000).unref()}else process.exit(0)}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
