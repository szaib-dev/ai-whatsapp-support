# Codetic AI CI/CD on the small VPS

Repository: szaib-dev/ai-whatsapp-support (public). VPS: 193.181.223.127, Ubuntu 24.04, user szb8480, checkout /opt/codetic. Capacity at setup: **1.6 GiB RAM, 2 GiB swap, 5.3 GB free disk**.

## Hosted builds and streaming deployment

Main pushes and manual main runs execute tests, lint, build, types, audit, deployment regression tests and Compose validation on GitHub's standard ubuntu-latest hosted runner. Pull requests validate only. **No self-hosted runner is installed or used; PR code never runs on the VPS.**

After validation, the hosted deployment job builds API then web sequentially in an isolated Buildx builder, with solver parallelism 2. Images carry the exact commit revision and ownership label net.codetic.cicd=szaib-dev/ai-whatsapp-support. Setup selects the VPS architecture, linux/amd64 or linux/arm64. Only public frontend values are supplied as build arguments; no production environment file, SSH key or private credential is sent to a build.

The runner streams a size header followed by compressed Docker images over pinned SSH. Docker loads directly from stdin: **no compilation, Docker build, saved archive or new build cache on the VPS**. No registry, registry token, persistent image artifact or extra subscription is required. Both images are transferred; only affected containers are recreated. This trades some transfer for a complete release when local runtime configuration also selects a service.

The hosted job prunes only its isolated builder cache; setup-buildx removes its builder/state during job cleanup, and the ephemeral runner is discarded. No persistent Actions image/cache artifact accumulates. Standard hosted runners for this public repository use GitHub's public-repository allowance; no paid larger runner is selected.

Source changes since the last successful release and effective Compose hashes determine service replacement. Frontend-only releases leave the WhatsApp worker running. First deployment conservatively updates both containers; shared package changes select both. Documentation/workflow-only releases do not restart containers after the baseline.

## One-time setup or upgrade

In the existing VPS terminal as szb8480, with production running and existing Docker access, paste this single block:

~~~bash
set -Eeuo pipefail
cd /opt/codetic
git fetch origin main
git merge --ff-only origin/main
bash scripts/setup-cicd.sh
~~~

Prerequisites: existing .env.production, trusted database CA, reviewed migration ledger and **untracked compose.vps.yaml**. Setup may request your normal sudo password to install client utilities and the restricted SSH wrapper. It never edits sudoers, grants passwordless sudo, adds Docker-group membership, installs a runner or changes firewall/SSH/tunnel configuration. Missing Docker access stops setup for administrator review. Existing Docker access is root-equivalent; restrict this account and main writes to trusted administrators.

Complete the one-time GitHub browser/device login with a repository administrator account. Setup creates dedicated keys when absent, adds a read-only repository deploy key, pins host keys, installs the forced command and uploads Actions secrets without printing private keys. A CLI login created by setup is logged out afterwards; an existing login remains. Existing authorized keys are preserved. Private keys stay mode 0600 outside Git.

Setup reads effective Compose build args and uploads only the public browser values below and architecture as repository variables. It never sources, uploads, prints or overwrites the production environment file/local override. Rerun setup after intentionally changing public browser build values. Never put a service-role key, database URL, encryption key or Google secret in a repository variable or browser build argument.

## Exact GitHub settings

**Settings → Actions → General:** enable Actions and allow actions/checkout, actions/setup-node, docker/setup-qemu-action and docker/setup-buildx-action. Keep workflow permissions at **read repository contents** and fork secrets disabled. No packages-write permission or paid environment is required.

**Settings → Secrets and variables → Actions → Repository secrets**, created by setup:

| Name | Purpose |
| --- | --- |
| VPS_SSH_KEY | Dedicated Ed25519 deployment identity |
| VPS_KNOWN_HOSTS | Pinned VPS public host key |

**Repository variables**, also created by setup:

| Name | Source |
| --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | Existing effective web build arg |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Existing public anon/publishable browser key |
| NEXT_PUBLIC_API_URL | Existing effective web build arg |
| NEXT_PUBLIC_SITE_URL | Existing effective web build arg |
| DEPLOY_PLATFORM | Existing Docker architecture |

Setup queues the first workflow. Manually use **Actions → Validate and deploy → Run workflow → main** when needed. Runs before setup fail safely on missing variables/secrets. Protect main, disable force pushes/deletion and require validate before merging. Enable your Actions failure notifications.

## Disk budget and safe cleanup

Before import, cleanup inventories all containers and owned CI images under the deployment lock. It preserves:

- Images referenced by **any running or stopped container**, including unrelated services.
- Actual API and web images serving before the deployment attempt.
- One previous successful image per service, pinned in .deploy/rollback-api.image and .deploy/rollback-web.image.

Only unused images with the exact Codetic CI ownership label are removal candidates. Removal uses Docker image rm with --no-prune and without force. Referenced or multi-tag images that Docker refuses to remove remain. Untagged parents, unlabelled/manual legacy images and unrelated images are not swept. Invalid retention metadata or failed inventory fails closed before import. Successful releases refresh pins only for changed images, then clean obsolete owned images again. Frontend-only releases preserve the backend's previous rollback pin.

The disk gate requires **twice the incoming uncompressed image sizes plus 512 MiB** available on Docker's filesystem before loading. This deliberately overestimates shared layers and allows staging/reserve space. If the budget exceeds available space, deployment stops before app shutdown and retains rollback images. Image-loading failures also leave existing containers running. This is a point-in-time gate: unrelated disk writers can consume space afterwards. Increase capacity rather than sacrificing the final rollback to force a release through.

No volume, container, network, system or global builder prune runs on the VPS. Existing default/shared build cache cannot be attributed safely to Codetic and remains untouched. Moving builds off-server prevents further Codetic build-cache growth. Old unlabelled images/default caches may require a one-time administrator ownership review if they already occupy most disk space. The pipeline never assumes everything unused on this shared VPS belongs to Codetic.

## Isolation, migrations and rollback

Strict SSH host checking and the forced command deploy FULL_COMMIT_SHA remain. Under flock, the wrapper fetches main, accepts only the latest requested main SHA and runs that commit's script. GitHub concurrency does not cancel active deployments; the VPS lock also serializes manual attempts. Superseded releases may close the stream early and succeed; the receiver's result is authoritative.

Imported tags must match expected revision and ownership labels. Trusted main code has deployment authority; no public PR or self-hosted public-repository runner receives deployment credentials.

Compose reads compose.production.yaml, existing untracked compose.vps.yaml when present and .deploy/images.yaml. Releases that attempt to track the local override are rejected. No copy, generated replacement, clean or reset overwrites it. Environment variables, encryption keys, WhatsApp sessions, database records and Calendar connections remain in existing config/database.

Only explicit api/web lifecycle commands run with no dependencies, no builds, no pulls and bounded health waits. There is no global up/down, scaling or second WhatsApp worker. Caddy, Cloudflare Tunnel, Asterisk, volumes, ports and unrelated services remain untouched. API replacement incurs a brief single-worker stop/start. Runtime limits/swap are not overwritten; hosted builds do not imply unlimited application capacity on 1.6 GiB RAM.

Read-only migration preflight checks the existing ledger/checksums. New SQL requires reviewed matching checksums and backwardCompatible:true in deploy/migration-policy.json. Changed, removed, incompatible or unreviewed SQL fails before API shutdown. An untracked database still requires the reviewed baseline procedure in DEPLOYMENT.md. Approved pending migrations stop only API and use a one-shot container whose CMD never starts a WhatsApp worker. Transactions and advisory locking remain.

Compose health and HTTP-200 public checks at the frontend and API /ready must succeed, without an interactive Cloudflare challenge. Compatible migration/runtime/health failures restore the previous tracked checkout and actual image IDs, recreating only touched services. Applied compatible SQL is not reversed. Failed initial baselines are never recorded as successful. Logs report phase and rollback outcome. Cleanup failure after a healthy release is reported without rolling back the healthy app.

Power, SSH, disk failures, revoked third-party access and database recovery can still require operator intervention. Image retention is not a database backup. Global readiness does not prove each clinic's phone authorization; clinics use /status for individual connection state.

## Records and validation

Keep ignored/private .deploy state across releases: lock, successful commit/config hashes, image override, rollback pins and bootstrap script. Inspect without dumping secrets:

~~~bash
cd /opt/codetic
cat .deploy/current.json
docker compose --env-file .env.production -f compose.production.yaml -f compose.vps.yaml -f .deploy/images.yaml ps api web
~~~

Use those same Compose files for manual app operations after adoption instead of the old global-stack deploy helper. Do not start a second WhatsApp worker from a laptop against production.

The deployment test script runs isolated fixtures against real scripts: service selection, migrations, runtime/public-health rollback, failed baseline, low disk, failed image loading, bad image provenance, failed cleanup inventory, local override protection, stale commits and sequential hosted builds. It verifies protected-image retention and absence of VPS builds, broad pruning, force image deletion or unrelated lifecycle changes. Application tests/lint/types/build/audit and Compose/workflow syntax run separately. Fixtures are not a live VPS rollout; observe the first deployment after setup.

References: [compressed stdin loading](https://docs.docker.com/reference/cli/docker/image/load/), [image removal semantics](https://docs.docker.com/reference/cli/docker/image/rm/), [isolated hosted builders](https://docs.docker.com/build/ci/github-actions/configure-builder/), [builder-specific cache pruning](https://docs.docker.com/reference/cli/docker/buildx/prune/).
