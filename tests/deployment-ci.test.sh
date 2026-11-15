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
from pathlib import Path
root=Path(os.environ['CASE_DIR']); path=root/'fixture.json'
state=json.loads(path.read_text()); name=sys.argv[1]; args=sys.argv[2:]
state['calls'].append([name]+args)
def save(): path.write_text(json.dumps(state))
def finish(value='',code=0):
 save()
 if value: print(value)
 sys.exit(code)
if name=='git':
 if args[:2]==['rev-parse','HEAD']: finish(state['head'])
 if args[:2]==['rev-parse','origin/main']: finish(('c'*40) if state['case']=='superseded' else 'b'*40)
 if args[:2]==['diff','--name-only']: finish('apps/web/app/page.tsx' if state['case'] in ['frontend','fail-web','fail-health'] else 'apps/api/src/server.ts\nsupabase/migrations/new.sql')
 if args[0]=='checkout': state['head']=args[-1]
 finish()
if name=='docker':
 if args[0]=='inspect': finish('sha256:old-api' if args[-1]=='api-container' else 'sha256:old-web')
 i=1
 while args[i] in ['--ansi','--env-file','-f']: i+=2
 op=args[i]; tail=args[i+1:]
 if op=='ps': finish('api-container' if tail[-1]=='api' else 'web-container')
 if op=='config': finish((tail[-1]+' '+tail[-1]+'-hash') if '--hash' in tail else '')
 if op=='run' and tail[-1]=='scripts/migration-status.mjs' and state['case']=='fail-preflight': finish(code=1)
 if op=='run' and tail[-1]=='scripts/migration-status.mjs': finish(json.dumps({'pending':[] if state['case'] in ['frontend','fail-web','fail-health'] else ['new.sql'],'rollbackSafe':True}))
 if op=='run' and tail[-1]=='scripts/migrate.mjs' and state['case'] in ['fail-migration','fail-first-deploy']: finish(code=1)
 if op=='up' and tail[-1]=='web' and state['case']=='fail-web' and not state.get('failed'):
  state['failed']=True;finish(code=1)
 finish()
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
for command in git docker jq curl flock sleep; do
 printf '#!/usr/bin/env bash\nexec python "$FIXTURE_PY" %s "$@"\n' "$command" > "$tmp/bin/$command"
 chmod +x "$tmp/bin/$command"
done
if command -v cygpath >/dev/null; then
 export FIXTURE_PY="$(cygpath -m "$tmp/fixture.py")"
else export FIXTURE_PY="$tmp/fixture.py"; fi
export PATH="$tmp/bin:$PATH"
for scenario in frontend backend fail-web fail-migration fail-preflight fail-health fail-first-deploy superseded; do
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
r.joinpath('.env.production').touch();r.joinpath('compose.production.yaml').touch();r.joinpath('compose.vps.yaml').write_text('LOCAL_CONFIG_MUST_STAY')
PY
 sed 's@cd /opt/codetic@cd "$TEST_REPO"@' "$repo/scripts/deploy-ci.sh" > "$directory/run.sh"
 result=0
 bash "$directory/run.sh" bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb > "$directory/output.log" 2>&1 || result=$?
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
elif case=='fail-preflight':
 assert os.environ['CASE_RESULT']!='0' and not ups and s['head']=='a'*40
 assert not any(c.endswith('stop api') or c.endswith('scripts/migrate.mjs') for c in calls)
else:
 assert os.environ['CASE_RESULT']!='0' and s['head']=='a'*40
 assert 'rollback healthy' in r.joinpath('output.log').read_text()
 assert not any(c.endswith('scripts/migrate.mjs') for c in calls) if case in ['fail-web','fail-health'] else True
 assert all(c.endswith('web') for c in ups) if case in ['fail-web','fail-health'] else all(c.endswith('api') for c in ups)
if case=='fail-first-deploy': assert not r.joinpath('.deploy/current.json').exists(), 'Failed initial baseline must be retried, never recorded as deployed'
print('PASS deployment scenario:',case)
PY
done
