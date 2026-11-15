#!/usr/bin/env bash
# Executed only on an ephemeral GitHub-hosted runner, never on the VPS.
set -Eeuo pipefail
: "${CI_BUILDER:?}" "${DEPLOY_SHA:?}" "${DEPLOY_PLATFORM:?}"
: "${NEXT_PUBLIC_SUPABASE_URL:?Run the VPS setup to configure public build variables}"
: "${NEXT_PUBLIC_SUPABASE_ANON_KEY:?Run the VPS setup to configure public build variables}"
: "${NEXT_PUBLIC_API_URL:?}" "${NEXT_PUBLIC_SITE_URL:?}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$DEPLOY_PLATFORM" == linux/amd64 || "$DEPLOY_PLATFORM" == linux/arm64 ]]
labels=(--label "net.codetic.cicd=szaib-dev/ai-whatsapp-support" --label "org.opencontainers.image.revision=$DEPLOY_SHA")
# Sequential builds; no production env, SSH secrets or private build arguments.
docker buildx build --builder "$CI_BUILDER" --platform "$DEPLOY_PLATFORM" --load "${labels[@]}" -t "codetic-api:$DEPLOY_SHA" -f Dockerfile .
docker buildx build --builder "$CI_BUILDER" --platform "$DEPLOY_PLATFORM" --load "${labels[@]}" \
 --build-arg "NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL" \
 --build-arg "NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
 --build-arg "NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL" \
 --build-arg "NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL" \
 -t "codetic-web:$DEPLOY_SHA" -f apps/web/Dockerfile .
