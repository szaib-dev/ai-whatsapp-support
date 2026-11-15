#!/usr/bin/env bash
# Exercises the real deployment script with isolated command fixtures, no Docker/VPS.
set -Eeuo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
temp_root="$(realpath "${TMPDIR:-/tmp}")"
tmp="$(mktemp -d "$temp_root/codetic-ci-test.XXXXXXXX")"
cleanup() {
 local resolved
 resolved="$(realpath "$tmp")"
 [[ "$resolved" == "$temp_root"/codetic-ci-test.* ]] && rm -rf -- "$resolved"
}
trap cleanup EXIT
mkdir -p "$tmp/bin"
cat > "$tmp/fixture.py" <<'PY'
import json,os,sys
sys.stdout.reconfigure(newline='\n')
from pathlib import Path
root=Path(os.environ['CASE_DIR']); path=root/'fixture.json'
state=json.loads(path.read_text()); name=sys.argv[1]; args=sys.argv[2:]
state['calls'].append([name]+args)
def save(): path.write_text(json.dumps(state))
def finish(value='',code=0):
 save()
 if value: print(value)
 sys.exit(code)
def image(ch): return 'sha256:'+ch*64
if name=='git':
 if args[0]=='cat-file': finish(code=0 if state['case']=='tracked-override' else 1)
 if args[:2]==['rev-parse','HEAD']: finish(state['head'])
 if args[:2]==['rev-parse','origin/main']: finish(('c'*40) if state['case']=='superseded' else 'b'*40)
 if args[:2]==['diff','--name-only']: finish('apps/web/app/page.tsx' if state['case'] in ['frontend','fail-web','fail-health','low-disk','fail-load','bad-provenance','inventory-failure'] else 'apps/api/src/server.ts\nsupabase/migrations/new.sql')
 if args[0]=='checkout': state['head']=args[-1]
 finish()
if name=='docker':
 if args[0]=='info': finish('/var/lib/docker')
 if args[0]=='ps':
  if state['case']=='inventory-failure': finish(code=1)
  finish('api-container\nweb-container\nstopped-other')
 if args[0]=='inspect': finish(state.get('running',{}).get(args[-1],image('a' if args[-1]=='api-container' else 'b' if args[-1]=='web-container' else '1')))
 if args[0]=='image':
  if args[1]=='ls':
   ids=[image(c) for c in ('abef01'+('cd' if state.get('loaded') else ''))]
   finish('\n'.join(i for i in ids if i not in state.get('removed',[])))
  if args[1]=='rm': state.setdefault('removed',[]).append(args[-1]);finish()
  if args[1]=='load':
   sys.stdin.read()
   if state['case']=='fail-load':finish(code=1)
   state['loaded']=True;finish()
  if args[1]=='inspect':
   if '.Config.Labels' in args[3]: finish(('wrong' if state['case']=='bad-provenance' else 'b'*40)+' szaib-dev/ai-whatsapp-support')
   finish(args[-1] if args[-1].startswith('sha256:') else image('c' if 'codetic-api:' in args[-1] else 'd'))
 i=1
 while args[i] in ['--ansi','--env-file','-f']: i+=2
 op=args[i]; tail=args[i+1:]
 if op=='ps': finish('api-container' if tail[-1]=='api' else 'web-container')
 if op=='config': finish((tail[-1]+' '+tail[-1]+'-hash') if '--hash' in tail else '')
 if op=='run' and tail[-1]=='scripts/migration-status.mjs' and state['case']=='fail-preflight': finish(code=1)
 if op=='run' and tail[-1]=='scripts/migration-status.mjs': finish(json.dumps({'pending':[] if state['case'] in ['frontend','fail-web','fail-health'] else ['new.sql'],'rollbackSafe':True}))
 if op=='run' and tail[-1]=='scripts/migrate.mjs' and state['case'] in ['fail-migration','fail-first-deploy']: finish(code=1)
 if op=='up':
  service=tail[-1]
  state.setdefault('running',{})[service+'-container']=image(('c' if service=='api' else 'd') if ('codetic-'+service+':') in root.joinpath('.deploy/images.yaml').read_text() else ('a' if service=='api' else 'b'))
  if service=='web' and state['case']=='fail-web' and not state.get('failed'):
   state['failed']=True;finish(code=1)
 finish()
if name=='df':finish('Filesystem 1-blocks Used Available Capacity Mounted on\n/dev/test 9999999999 1 '+('100' if state['case']=='low-disk' else '9000000000')+' 1% /')
if name=='curl': finish('503' if state['case']=='fail-health' else '200')
if name=='jq':
 if args[0]=='-n':
  values={};i=1
  while args[i]=='--arg': values[args[i+1]]=args[i+2];i+=3
  finish(json.dumps({'commit':values['commit'],'config':{'api':values['api'],'web':values['web']}}))
 query=args[1]
 value=json.loads(Path(args[2]).read_text()) if len(args)>2 else json.load(sys.stdin)
 if query=='.pending | length': finish(str(len(value['pending'])))
 keys=query.split(' //')[0].strip('.').split('.')
 for k in keys:value=value.get(k,'') if isinstance(value,dict) else ''
 finish(str(value))
finish()
PY
for command in git docker jq curl flock sleep df; do
 printf '#!/usr/bin/env bash\nexec python "$FIXTURE_PY" %s "$@"\n' "$command" > "$tmp/bin/$command"
 chmod +x "$tmp/bin/$command"
done
if command -v cygpath >/dev/null; then
 export FIXTURE_PY="$(cygpath -m "$tmp/fixture.py")"
else export FIXTURE_PY="$tmp/fixture.py"; fi
export PATH="$tmp/bin:$PATH"
for scenario in frontend backend fail-web fail-migration fail-preflight fail-health fail-first-deploy low-disk fail-load bad-provenance inventory-failure invalid-pin tracked-override superseded; do
 directory="$tmp/$scenario"
 mkdir -p "$directory/.deploy"
 if command -v cygpath >/dev/null; then export CASE_DIR="$(cygpath -m "$directory")"; else export CASE_DIR="$directory"; fi
 export TEST_REPO="$CASE_DIR"
 python - "$scenario" <<'PY'
import json,os,sys
from pathlib import Path
r=Path(os.environ['CASE_DIR']);r.joinpath('fixture.json').write_text(json.dumps({'case':sys.argv[1],'head':'a'*40,'calls':[]}))
r.joinpath('.deploy/current.json').write_text(json.dumps({'commit':'a'*40,'config':{'api':'api-hash','web':'web-hash'}}))
if sys.argv[1]=='fail-first-deploy': r.joinpath('.deploy/current.json').unlink()
for svc,ch in [('api','e'),('web','f')]:r.joinpath('.deploy/rollback-'+svc+'.image').write_text('sha256:'+ch*64+'\n')
if sys.argv[1]=='invalid-pin':r.joinpath('.deploy/rollback-api.image').write_text('invalid')
r.joinpath('.env.production').touch();r.joinpath('compose.production.yaml').touch();r.joinpath('compose.vps.yaml').write_text('LOCAL_CONFIG_MUST_STAY')
PY
 sed 's@cd /opt/codetic@cd "$TEST_REPO"@' "$repo/scripts/deploy-ci.sh" > "$directory/run.sh"
 result=0
 printf '1000000\nimage-stream' | bash "$directory/run.sh" bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb > "$directory/output.log" 2>&1 || result=$?
 export CASE_RESULT="$result"
 python - "$scenario" <<'PY'
import json,os,sys
from pathlib import Path
r=Path(os.environ['CASE_DIR']);s=json.loads(r.joinpath('fixture.json').read_text());case=sys.argv[1];calls=[' '.join(c) for c in s['calls']]
assert r.joinpath('compose.vps.yaml').read_text()=='LOCAL_CONFIG_MUST_STAY'
assert r.joinpath('.env.production').exists()
assert not any(' down' in c or ' prune' in c or '--remove-orphans' in c for c in calls)
ups=[c for c in calls if c.startswith('docker ') and ' up ' in c]
assert not any(c.endswith('caddy') or c.endswith('cloudflared') for c in ups)
if case=='superseded': assert not ups and os.environ['CASE_RESULT']=='0'
elif case=='frontend':
 assert os.environ['CASE_RESULT']=='0'
 assert len(ups)==1 and ups[0].endswith('web') and '--no-deps' in ups[0]
 assert not any(c.endswith('build api') or c.endswith('stop api') for c in calls)
elif case=='backend':
 assert os.environ['CASE_RESULT']=='0' and len(ups)==1 and ups[0].endswith('api')
 stop=next(i for i,c in enumerate(calls) if c.endswith('stop api'))
 migrate=next(i for i,c in enumerate(calls) if c.endswith('scripts/migrate.mjs'))
 start=next(i for i,c in enumerate(calls) if ' up ' in c)
 assert stop<migrate<start
elif case in ['fail-preflight','low-disk','fail-load','bad-provenance','inventory-failure','invalid-pin','tracked-override']:
 assert os.environ['CASE_RESULT']!='0' and not ups and s['head']=='a'*40
 assert not any(c.endswith('stop api') or c.endswith('scripts/migrate.mjs') for c in calls)
else:
 assert os.environ['CASE_RESULT']!='0' and s['head']=='a'*40
 assert 'rollback healthy' in r.joinpath('output.log').read_text()
 assert not any(c.endswith('scripts/migrate.mjs') for c in calls) if case in ['fail-web','fail-health'] else True
 assert all(c.endswith('web') for c in ups) if case in ['fail-web','fail-health'] else all(c.endswith('api') for c in ups)
removed=s.get('removed',[])
assert not any(c.startswith('docker ') and (' build ' in c or ' buildx ' in c or ' volume ' in c or ' system ' in c or ' container rm' in c) for c in calls)
assert not any(i in removed for i in ['sha256:'+'a'*64,'sha256:'+'b'*64,'sha256:'+'1'*64])
assert all('--no-prune' in c and '--force' not in c for c in calls if c.startswith('docker image rm'))
if case=='frontend':
 assert r.joinpath('.deploy/rollback-api.image').read_text().strip()=='sha256:'+'e'*64
 assert r.joinpath('.deploy/rollback-web.image').read_text().strip()=='sha256:'+'b'*64
 assert 'sha256:'+'0'*64 in removed and 'sha256:'+'c'*64 in removed, (removed,r.joinpath('output.log').read_text(),calls)
 assert 'sha256:'+'d'*64 not in removed and 'sha256:'+'e'*64 not in removed
if case=='low-disk': assert not s.get('loaded')
if case in ['inventory-failure','invalid-pin','tracked-override']: assert not removed
if case=='fail-first-deploy': assert not r.joinpath('.deploy/current.json').exists(), 'Failed initial baseline must be retried, never recorded as deployed'
print('PASS deployment scenario:',case)
PY
done

# Hosted image builds must remain sequential and use only public frontend inputs.
export CI_BUILDER=test-hosted-builder DEPLOY_SHA=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb DEPLOY_PLATFORM=linux/amd64
export NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=public-test-anon
export NEXT_PUBLIC_API_URL=https://api.netawaz.pk NEXT_PUBLIC_SITE_URL=https://codetic.netawaz.pk
bash "$repo/scripts/build-ci-images.sh"
python - <<'PY'
import json,os
from pathlib import Path
calls=json.loads(Path(os.environ['CASE_DIR']).joinpath('fixture.json').read_text())['calls']
builds=[c for c in calls if c[:3]==['docker','buildx','build']]
assert len(builds)==2
assert 'codetic-api:'+os.environ['DEPLOY_SHA'] in builds[0] and 'codetic-web:'+os.environ['DEPLOY_SHA'] in builds[1]
assert all('--load' in c and '--platform' in c and '--builder' in c for c in builds)
print('PASS hosted sequential image builds')
PY
