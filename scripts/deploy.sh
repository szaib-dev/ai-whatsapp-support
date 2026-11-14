#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
[[ -f .env.production ]] || { echo 'Create .env.production first.' >&2; exit 1; }
[[ -s deploy/secrets/db-ca.pem ]] || { echo 'Install the trusted database CA at deploy/secrets/db-ca.pem.' >&2; exit 1; }
compose=(docker compose --env-file .env.production -f compose.production.yaml)
"${compose[@]}" config --quiet
"${compose[@]}" build --pull
"${compose[@]}" run --rm --no-deps api node scripts/production-check.mjs
# A verified backup is required before invoking this script for an update.
# Existing legacy schemas need one explicit baseline first; see DEPLOYMENT.md.
"${compose[@]}" stop api
"${compose[@]}" run --rm --no-deps api node scripts/migrate.mjs
"${compose[@]}" up -d --wait --wait-timeout 180
"${compose[@]}" ps
printf '%s\n' 'Run bash scripts/smoke-production.sh after DNS and HTTPS are ready.'
