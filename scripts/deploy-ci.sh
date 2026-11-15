#!/usr/bin/env bash
# Only api/web are managed. The functions are parsed before main changes checkout.
set -Eeuo pipefail
umask 077
log() { printf '[codetic] %s\n' "$*"; }
compose() {
 local args=(docker compose --ansi never --env-file .env.production -f compose.production.yaml)
 [[ ! -f compose.vps.yaml ]] || args+=(-f compose.vps.yaml)
 [[ ! -f .deploy/images.yaml ]] || args+=(-f .deploy/images.yaml)
 "${args[@]}" "$@"
}
write_images() {
 printf 'services:\n  api:\n    image: "%s"\n  web:\n    image: "%s"\n' "$1" "$2" > .deploy/images.yaml
}
config_hash() { compose config --hash "$1" | awk '{print $2}'; }
record_success() {
 jq -n --arg commit "$1" --arg api "$(config_hash api)" --arg web "$(config_hash web)" \
  '{commit:$commit,config:{api:$api,web:$web}}' > .deploy/current.json.tmp
 mv .deploy/current.json.tmp .deploy/current.json
}
check_public() {
 local url attempt status
 for url in https://codetic.netawaz.pk/ https://api.netawaz.pk/ready; do
  for attempt in {1..12}; do
   status="$(curl --silent --show-error --max-time 15 --output /dev/null --write-out '%{http_code}' "$url")" || status=000
   if [[ "$status" == 200 ]]; then break; fi
   [[ "$attempt" != 12 ]] || return 1
   sleep 5
  done
 done
}
rollback() {
 local result=$?
 trap - EXIT HUP INT TERM
 [[ "$result" != 0 ]] || return 0
 log "FAILED phase=$phase commit=$target"
 if [[ "$code_changed" == 1 ]]; then
  # The checkout was verified clean before deployment; ignored secrets stay untouched.
  if ! git checkout --quiet -B main "$old_head"; then
   log 'ROLLBACK FAILED: could not restore tracked configuration; manual review required.'
   exit "$result"
  fi
 fi
 if [[ "$runtime_changed" == 1 ]]; then
  write_images "$old_api" "$old_web"
  local services=()
  [[ "$api_touched" != 1 ]] || services+=(api)
  [[ "$web_touched" != 1 ]] || services+=(web)
  if compose up -d --no-deps --no-build --pull never --wait --wait-timeout 180 "${services[@]}"; then
   if [[ "$had_state" == 1 ]]; then record_success "$old_commit"; fi
   log 'Application rollback healthy. Database migrations were NOT reversed.'
  else
   log 'ROLLBACK FAILED: retained previous images and deployment state for operator review.'
  fi
 elif [[ -f .deploy/previous-images.yaml ]]; then
  cp .deploy/previous-images.yaml .deploy/images.yaml
 fi
 exit "$result"
}
main() {
 cd /opt/codetic
 target="${1:-}"; phase=preflight; code_changed=0; runtime_changed=0
 api_changed=0; web_changed=0; api_touched=0; web_touched=0; had_state=0; old_head=''; old_commit=''; old_api=''; old_web=''; local api_id web_id
 [[ "$target" =~ ^[0-9a-f]{40}$ ]] || { log 'Expected an exact validated commit SHA.'; return 1; }
 mkdir -p .deploy
 if [[ "${CODETIC_LOCK_HELD:-}" != 1 ]]; then
  exec 9>.deploy/deploy.lock
  flock -w 1800 9 || { log 'Deployment lock timed out.'; return 1; }
 fi
 [[ -f .env.production ]] || { log 'Missing existing production environment.'; return 1; }
 git diff --quiet && git diff --cached --quiet || { log 'Tracked checkout is dirty; refusing to overwrite operator changes.'; return 1; }
 git fetch --quiet origin main
 if [[ "$(git rev-parse origin/main)" != "$target" ]]; then log 'Skipped superseded commit.'; return 0; fi
 [[ ! -f .deploy/current.json ]] || had_state=1
 old_head="$(git rev-parse HEAD)"
 old_commit="$(jq -r '.commit // empty' .deploy/current.json 2>/dev/null || true)"
 [[ -n "$old_commit" ]] || old_commit="$old_head"
 compose config --quiet
 api_id="$(compose ps -q api)"; web_id="$(compose ps -q web)"
 [[ -n "$api_id" && -n "$web_id" ]] || { log 'Existing api/web containers required for safe rollback; complete initial deployment first.'; return 1; }
 old_api="$(docker inspect --format '{{.Image}}' "$api_id")"
 old_web="$(docker inspect --format '{{.Image}}' "$web_id")"
 [[ "$old_api" == sha256:* && "$old_web" == sha256:* ]] || return 1
 [[ -f .deploy/images.yaml ]] || write_images "$old_api" "$old_web"
 cp .deploy/images.yaml .deploy/previous-images.yaml
 local before_api before_web saved_api saved_web changed
 before_api="$(config_hash api)"; before_web="$(config_hash web)"
 saved_api="$(jq -r '.config.api // empty' .deploy/current.json 2>/dev/null || true)"
 saved_web="$(jq -r '.config.web // empty' .deploy/current.json 2>/dev/null || true)"
 trap rollback EXIT
 trap 'exit 129' HUP
 trap 'exit 130' INT
 trap 'exit 143' TERM
 phase=checkout
 git merge-base --is-ancestor "$old_commit" "$target" || { log 'Target is not a forward release; automatic deployment refused.'; return 1; }
 changed="$(git diff --name-only "$old_commit" "$target")"
 git checkout --quiet -B main "$target"
 code_changed=1
 # First deployment is a conservative baseline. Future changes are service-specific.
 if [[ ! -f .deploy/current.json ]]; then api_changed=1; web_changed=1; fi
 if grep -Eq '^(apps/api/|Dockerfile$|supabase/migrations/|deploy/migration-policy.json$|scripts/(migrate|migration-status|migration-policy|production-check)\.mjs$|apps/(api|web)/package\.json$|\.dockerignore$|package(-lock)?\.json$|tsconfig[^/]*\.json$)' <<< "$changed"; then api_changed=1; fi
 if grep -Eq '^(apps/web/|apps/api/package\.json$|\.dockerignore$|package(-lock)?\.json$)' <<< "$changed"; then web_changed=1; fi
 [[ "$(config_hash api)" == "$before_api" && ( -z "$saved_api" || "$saved_api" == "$before_api" ) ]] || api_changed=1
 [[ "$(config_hash web)" == "$before_web" && ( -z "$saved_web" || "$saved_web" == "$before_web" ) ]] || web_changed=1
 log "Release $target api_changed=$api_changed web_changed=$web_changed"
 phase=build
 local api_image="$old_api" web_image="$old_web"
 [[ "$api_changed" != 1 ]] || api_image="codetic-api:$target"
 [[ "$web_changed" != 1 ]] || web_image="codetic-web:$target"
 write_images "$api_image" "$web_image"
 # Build while old containers serve traffic. No global up/down, pulls or pruning.
 if [[ "$api_changed" == 1 ]]; then compose build api; fi
 if [[ "$web_changed" == 1 ]]; then compose build web; fi
 phase=configuration
 if [[ "$api_changed" == 1 ]]; then
  compose run --rm --no-deps -T api node scripts/production-check.mjs
  phase=migration-preflight
  local migration_info pending
  migration_info="$(compose run --rm --no-deps -T api node scripts/migration-status.mjs)"
  pending="$(jq -er '.pending | length' <<< "$migration_info")"
  if [[ "$pending" != 0 ]]; then
   phase=migrate
   # Migration/preflight CMD overrides never start a WhatsApp worker.
   runtime_changed=1; api_touched=1
   compose stop api
   compose run --rm --no-deps -T api node scripts/migrate.mjs
  fi
 fi
 phase=recreate
 if [[ "$api_changed" == 1 ]]; then
  runtime_changed=1; api_touched=1
  compose up -d --no-deps --no-build --pull never --wait --wait-timeout 180 api
 fi
 if [[ "$web_changed" == 1 ]]; then
  runtime_changed=1; web_touched=1
  compose up -d --no-deps --no-build --pull never --wait --wait-timeout 180 web
 fi
 phase=public-health
 check_public
 record_success "$target"
 phase=complete
 trap - EXIT HUP INT TERM
 log "SUCCESS $target. Previous images retained: api=$old_api web=$old_web"
}
main "$@"
