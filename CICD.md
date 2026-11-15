# Codetic AI automatic deployment

Repository: `szaib-dev/ai-whatsapp-support` · VPS: `193.181.223.127` · user: `szb8480` · checkout: `/opt/codetic`.

## What happens on push

`.github/workflows/ci.yml` validates pushes to `main`, pull requests and manual workflow runs. Tests, lint, production build, type checks, dependency audit, shell deployment tests and Compose-template validation must succeed. Only a successful `main` push/manual run can enter the SSH deployment job. Pull requests never deploy. The workflow has read-only GitHub contents permissions.

The deployment uses the existing SSH service on port 22, a dedicated Ed25519 identity, a pinned VPS host key and a forced command accepting only `deploy FULL_COMMIT_SHA`. It does not use passwords, disable host verification, expose credentials in command arguments, or open any new port. Repository source fetch uses a separate **read-only** GitHub deploy key. Existing SSH access and other authorized keys are preserved.

GitHub concurrency does not cancel an active deployment. A VPS `flock` also serializes manual and CI deployments; a remote deployment still holding the lock cannot be bypassed by another workflow. Superseded commits are skipped rather than replacing a newer `main`. GitHub can replace pending jobs in a concurrency group; latest validated main is the desired deployed state.

The restricted SSH wrapper is installed at `/usr/local/lib/codetic/ssh-entrypoint.sh`. Under its lock it fetches main, verifies the exact requested SHA, and runs that commit's deployment script. It does not accept arbitrary shell commands or an unvalidated branch. Protect write access to main: trusted main code necessarily has application/deployment authority.

## One-time setup: one command block

Prerequisites: the existing production api/web containers are already running from `/opt/codetic`; `.env.production`, the trusted database CA, reviewed migration ledger and existing `compose.vps.yaml` are correct. This is an update pipeline, not a replacement first-time infrastructure installer. GitHub-hosted runners must be able to reach your **existing** SSH endpoint; this setup does not change firewall, SSH daemon, Cloudflare Access or tunnel rules. If SSH is intentionally restricted, arrange access through your existing access policy during initial setup.

Paste this **in your VPS terminal as `szb8480`**, not root or Windows PowerShell:

```bash
set -Eeuo pipefail
cd /opt/codetic
git fetch origin main
git merge --ff-only origin/main
bash scripts/setup-cicd.sh
```

The script installs client utilities (`gh`, `jq`, OpenSSH client, util-linux), checks Docker access, creates dedicated keys if missing, installs the forced-command wrapper, adds only its own authorized key, pins GitHub/VPS host keys, adds a read-only repository deploy key, stores the Actions secrets and dispatches the initial workflow. It does not print private keys or change `.env.production`. If Docker group membership is needed, it activates it for the setup session. **Docker access is root-equivalent**, so this account, its SSH access and main-branch write permissions must be restricted to trusted administrators.

If GitHub CLI is not already authenticated, the script asks you to complete its one-time browser/device login. Use an account with administration access to this repository and permission to create deploy keys/Actions secrets; authorize any required organization SSO. This interactive authentication is part of initial setup, not every deployment. If the script created the CLI login, it logs that session out after configuring secrets and dispatching the workflow; an existing CLI login is left alone. The dedicated read-only Git key continues to work without that CLI token. Private keys stay mode 0600 outside the checkout, never inside Git.

Dirty tracked files cause setup/deployment to stop rather than overwrite operator changes. Resolve real source changes through Git before setup. `compose.vps.yaml` is intentionally ignored as **VPS-local configuration**; no sample is copied over it. Existing `.env.production`, certificates, keys, volumes and database records are preserved.

## Exact GitHub settings

Repository **Settings → Secrets and variables → Actions → Repository secrets**:

| Secret | Initial setup creates it from |
| --- | --- |
| `VPS_SSH_KEY` | Dedicated private Ed25519 key, uploaded directly using `gh secret set` |
| `VPS_KNOWN_HOSTS` | The VPS's own `/etc/ssh/ssh_host_ed25519_key.pub`, paired with `193.181.223.127` |

Do not use the host key obtained by an unauthenticated `ssh-keyscan`. On a genuine VPS host-key change, verify the new key through the VPS console and rerun setup; do not bypass strict checking. These are repository secrets, not GitHub Variables and not environment secrets. No `production` environment or paid environment-protection feature is required.

Repository **Settings → Actions → General**:

- Enable Actions for this repository and permit GitHub-owned `actions/checkout` and `actions/setup-node`.
- Workflow permissions: **Read repository contents**. Do not grant unnecessary write permissions or PR-creation rights.
- Keep fork pull-request secrets disabled. Require approval for workflows from outside collaborators as appropriate. Never run untrusted PR code on the VPS.

Repository **Settings → Rules → Rulesets** (or Branch protection), when available on your plan:

- Target `main`; disallow force pushes and branch deletion.
- Require the **validate** check from **Validate and deploy** before merging. Do not require the post-merge deployment job as a pre-merge check.
- Restrict pushes/merges to trusted maintainers; add review requirements appropriate to your team.

GitHub **Actions → Validate and deploy → Run workflow → main** manually revalidates/redeploys latest main. The setup script queues the first run itself. A job already triggered before secrets are installed can fail safely at SSH setup; use the queued fresh run after setup.

GitHub-hosted Actions uses the repository's included allowance/public-repository eligibility; no registry, SaaS deployment subscription or extra server is introduced. For private repositories, set an Actions spending limit/budget of zero if you require a strict no-charge policy. Exhausting the included allowance can stop Actions until it resets; free unlimited private build minutes cannot be promised. Enable your GitHub Actions failure email/web notifications under your personal notification settings. Job failures and rollback outcomes also appear in Actions logs/summary; no external email service is required.

## Service selection and downtime

- The first successful pipeline deployment establishes a conservative baseline and may rebuild/recreate both application containers once.
- Afterwards, changes in `apps/web` rebuild/recreate only `web`. API code, API Dockerfile, migrations or shared dependency/compiler inputs select `api`. Shared package files select both.
- Effective Compose hashes also detect api/web runtime configuration changes, including the existing local override. State is based on the last **successful** deployment, so a failed build is not mistaken for a deployed release.
- Docs/workflow-only changes do not restart application containers once the baseline exists.
- Builds occur while old containers continue serving. Application images use commit-specific tags and previous actual image IDs are retained.
- Application services are recreated explicitly using `--no-deps --no-build --pull never --wait`. There is no global `up`, `down`, volume deletion, pruning, `--remove-orphans`, API scaling or simultaneous blue/green WhatsApp worker.
- API code changes incur the brief stop/start needed for a single worker. Frontend-only changes leave API transport running. Database credentials, session encryption key, saved WhatsApp auth, Calendar connections and durable inbox remain in the same database/configuration.

The script always reads `compose.production.yaml` plus the existing `compose.vps.yaml` when present. `.deploy/images.yaml` overrides only api/web image references. It does **not** start, stop, build, pull or recreate Caddy, Cloudflare Tunnel/cloudflared, Asterisk or other services. It does not modify ports 3000/3101, tunnel routing, reverse proxy configuration, firewall, DNS or production secrets. Deliberate infrastructure/proxy changes remain outside this application deployer's scope.

## Database migrations and rollback

API builds include migration preflight tooling. The preflight checks the existing private migration ledger and content hashes, then finds unapplied migrations. `deploy/migration-policy.json` records reviewed normalized SHA-256 checksums and `backwardCompatible:true` for eligible migrations. When adding a migration, include its reviewed policy entry in the same code push. Declaring compatibility is a developer review obligation, not a claim that a regex can prove SQL semantics.

Unreviewed, changed or incompatible pending migrations fail before the API stops. No silent baseline, reset, automatic down migration or destructive rollback is performed. Adopt legacy schemas once using the reviewed procedure in `DEPLOYMENT.md`, before enabling CD. The existing migration runner still provides transactions, checksums and a database advisory lock.

If migrations are pending and approved, the API is stopped only after builds/preflight succeed. A one-shot container runs `node scripts/migrate.mjs` with the CMD overridden; it never starts a WhatsApp manager. Then the single API service is recreated. Existing worker shutdown and restart policies remain in force. Migrations that require breaking old-version compatibility need a separate maintenance/roll-forward design and are intentionally refused by this automatic path.

On an application migration/startup/public-health failure, the trap restores the prior tracked checkout and saved application image IDs, recreating only affected application services. Applied compatible database migrations remain; they are not reversed. `.env.production`, VPS-local overrides and volumes are not restored from Git or overwritten. A partial migration failure is rollback-safe only because every migration in the batch was explicitly reviewed as backward-compatible. The operator still needs tested backups and recovery practices; pipeline rollback is not a database backup.

If rollback itself fails, the job reports failure and retains state/images for review instead of falsely claiming recovery. A powered-off VPS, exhausted disk, inaccessible database, revoked third-party access, invalid secrets or broken SSH cannot be repaired by CI. These failures require operator intervention; successful routine pushes require none.

## Health, records and troubleshooting

Public checks require HTTP 200, so redirects/challenges are not accepted as a healthy release. Each affected container must pass its Compose health check, with a bounded wait. The public website and `https://api.netawaz.pk/ready` are then checked through the existing tunnel with bounded retries. Public health endpoints must be reachable without a Cloudflare interactive challenge. The global API readiness check verifies DB/manager readiness; it does not promise every individual clinic's WhatsApp authorization is still valid. Clinics use `/status` for their own connection state.

Deployment logs show commit, selected services, phase, result and rollback outcome, without dumping Compose's expanded environment or reading `.env` into logs. GitHub SSH key files are removed from the ephemeral runner on exit. Existing app log redaction is retained. `.deploy/` is ignored and private (umask 077); it contains the lock, current successful commit/config hashes, current image override and bootstrap script. Do not remove it during updates. No automatic image/volume cleanup is run; monitor disk space and perform reviewed cleanup that retains rollback images.

On the VPS, inspect without printing secrets:

```bash
cd /opt/codetic
cat .deploy/current.json
docker compose --env-file .env.production -f compose.production.yaml -f compose.vps.yaml -f .deploy/images.yaml ps api web
```

Use the same three Compose files for manual application operations after CD adoption. A plain global `docker compose up` using a different project/override can revert image selection or touch infrastructure. Do not launch an additional worker against the production database from a laptop; the application's database lease deliberately prevents duplicate managers.

## Validation and limits

`bash tests/deployment-ci.test.sh` exercises the real deployment script with isolated command fixtures: frontend-only update, API+migration update, frontend rollback, migration-failure rollback, preflight rejection, public-health rollback, failed initial baseline and stale-commit skip. It checks that secrets/local override remain, forbidden lifecycle commands are absent and no proxy/tunnel service is recreated. GitHub runs these tests as part of validation, alongside the application tests/builds and shell syntax checks.

The fixtures do not claim a live SSH/VPS deployment. No private SSH key or GitHub settings access was supplied in this coding session, so the actual remote rollout must be observed after the one-time setup. The manual workflow and automatic push use the same validation/deployment path. Existing deployment, backups and Google verification guidance remains in `DEPLOYMENT.md` and `GOOGLE_VERIFICATION_CHECKLIST.md`.

References: [GitHub concurrency](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/control-the-concurrency-of-workflows-and-jobs), [Compose up flags](https://docs.docker.com/reference/cli/docker/compose/up/). Official documentation was checked during implementation.
