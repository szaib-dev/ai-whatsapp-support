#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
cd /opt/codetic
mkdir -p .deploy
exec 9>.deploy/deploy.lock
flock -w 1800 9 || { echo 'Another deployment still holds the VPS lock.' >&2; exit 1; }
[[ "${SSH_ORIGINAL_COMMAND:-}" =~ ^deploy\ ([0-9a-f]{40})$ ]] || { echo 'Only deploy COMMIT_SHA is permitted.' >&2; exit 1; }
sha="${BASH_REMATCH[1]}"
git fetch --quiet origin main
if [[ "$(git rev-parse origin/main)" != "$sha" ]]; then
 echo 'Skipped: this validated commit was superseded by newer main.'
 exit 0
fi
git show "$sha:scripts/deploy-ci.sh" > ".deploy/bootstrap-$sha.sh"
export CODETIC_LOCK_HELD=1
exec bash ".deploy/bootstrap-$sha.sh" "$sha"
