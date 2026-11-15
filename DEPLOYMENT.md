# Codetic AI: Ubuntu 24.04 deployment

This prepares the existing Next.js + Fastify + Baileys + Supabase/PostgreSQL application. It does not provision a VPS, change DNS, grant Google approval or replace the database. Use a private source repository or a private source transfer; do not upload populated environment files, backups or keys to GitHub.

## Addresses and routing

| Address | Purpose |
| --- | --- |
| `https://codetic.netawaz.pk/` | Public website |
| `https://codetic.netawaz.pk/status` | Separate clinic login |
| `https://codetic.netawaz.pk/admin/login` | Supabase administrator login |
| `https://codetic.netawaz.pk/admin` | Server-authorized dashboard |
| `https://api.netawaz.pk` | Fastify API |
| `https://api.netawaz.pk/calendar/oauth/callback` | Google callback |

Only Caddy publishes ports. Web (3000) and API (3101) remain on the private Compose network. Caddy persists certificates in `caddy_data` and state in `caddy_config`. WhatsApp credentials, messages, queues and Google connections live in the existing database, not an ephemeral container filesystem. Keep **one API/WhatsApp worker** for a database: the advisory lease intentionally rejects competing managers. Stop the old Windows development API and its supervisor before starting the VPS worker against that same database.

## 1. DNS and networking

Create these records at the DNS provider. Replace `VPS_IPV4` with the actual server address:

| Type | Name | Value |
| --- | --- | --- |
| A | `codetic` | `VPS_IPV4` |
| A | `api` | `VPS_IPV4` |

Use an AAAA record only if the VPS actually has working public IPv6. Remove stale conflicting AAAA records. Allow inbound TCP 80/443 and, optionally, UDP 443 for HTTP/3. Keep SSH restricted to your administrative network. Do not open 3000, 3101, 3102 or database ports publicly. If using a DNS proxy, use a mode compatible with ACME and authenticated origin TLS; do not turn off certificate verification.

## 2. Install Docker Engine and Compose

Run on **Ubuntu 24.04**, not in Windows PowerShell. Follow the [official Docker Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/) if package names or signing instructions change.

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker version
sudo docker compose version
```

Docker group membership is effectively root access. The commands below use `sudo` rather than silently granting it. A 2-vCPU/4-GB VPS is a sensible starting point for this configuration, not a measured capacity guarantee. Load-test your expected number of clinics and tune limits before launch.

## 3. Install source and private configuration

Clone your **actual private repository**, or transfer the existing checkout privately to `/opt/codetic`. No public repository or GitHub push has been created by this change.

```bash
sudo install -d -m 0750 -o "$USER" -g "$USER" /opt/codetic
cd /opt/codetic
# If cloning, use your real private repository address:
# git clone PRIVATE_REPOSITORY_URL .
cp .env.production.example .env.production
chmod 600 .env.production
mkdir -p deploy/secrets
chmod 700 deploy/secrets
```

Privately transfer your database provider's trusted CA to `deploy/secrets/db-ca.pem`, then:

```bash
chmod 644 deploy/secrets/db-ca.pem
nano .env.production
```

The CA is a public trust certificate, not a private key. Use the provider's real CA; do not generate a self-signed substitute or disable verification. The parent directory is not exposed by the web server or copied into the images.

Configure:

- The **existing** database URL. Use direct PostgreSQL or Supabase **session** pooling on 5432. Transaction pooling on 6543 is incompatible with session advisory locks and LISTEN/NOTIFY. URL-encode password characters. Do not add `sslmode`, `sslcert`, `sslkey` or `sslrootcert` URL overrides; the application uses the mounted CA with certificate verification.
- The existing `SESSION_ENCRYPTION_KEY`, unchanged, privately copied from the current server. **Do not generate a replacement key.** A new key makes existing WhatsApp sessions, Google refresh tokens and PKCE records unreadable. Keep a separate encrypted/offline recovery copy.
- Public Supabase URL and **anon/publishable** key, never the service-role key. Only these public values and the public API/site URLs are Docker build arguments for the web app.
- Existing DeepSeek key and Google **Web application** OAuth client ID/secret. No Google secret, database URL or encryption key is passed to the web container.
- `WEB_ORIGIN=https://codetic.netawaz.pk`, `PUBLIC_API_URL=https://api.netawaz.pk`, `CALENDAR_ALLOW_LOCAL_OAUTH=false`.
- Operator details are prefilled from the supplied information: Shahzaib Mirza, operating the Codetic brand as an individual in Pakistan; support/privacy email `szaib.dev@gmail.com`. They remain environment-configurable.
- An accurate `BACKUP_RETENTION_DESCRIPTION` covering the actual Supabase plan and offsite backup lifecycle. The application has no automatic conversation purge; do not describe one as implemented.
- `LEGAL_DISCLOSURES_APPROVED=true` only after reviewing the public legal text, retention/deletion process and actual backup arrangements.
- `AI_PROVIDER_DATA_TERMS_CONFIRMED=true` only after verifying the provider terms permit the disclosed processing and meet Google's Limited Use restrictions, including restrictions on raw and derived Google data. Merely having an API key is not this verification.

These last three items are intentional release blockers. The startup check reports variable names and issues, not their secret values. The pre-release notice disappears from the legal pages only when disclosures are approved. Approval flags are operator attestations, not automated legal or Google approval.

For a new installation, create an administrator through Supabase Authentication. Existing organization members already have workspace access. To bootstrap the first business for an otherwise unassigned user, put that verified Supabase user's UUID in `ADMIN_USER_IDS`; remove unnecessary bootstrap entries after setup. Do not use clinic portal credentials as admin credentials. Set the Supabase Auth Site URL/allowed redirect URLs to the production admin addresses, retaining explicit localhost URLs only if needed for development.

## 4. Back up and baseline the existing database

Take and verify a current Supabase/provider backup before migrating. Confirm the recovery method includes **Supabase Auth users**, application data and the existing encryption key. An application-only dump is not a complete replacement for a managed database backup.

```bash
sudo docker compose --env-file .env.production -f compose.production.yaml config --quiet
sudo docker compose --env-file .env.production -f compose.production.yaml build --pull
sudo docker compose --env-file .env.production -f compose.production.yaml run --rm --no-deps api node scripts/production-check.mjs
```

The migration runner uses transactions, a database advisory lock, line-ending-normalized migration checksums and a private `codetic_ops` ledger. It refuses to silently replay CREATE TABLE migrations into an existing untracked schema.

**For this existing application:** after reviewing the real schema and confirming migrations `202611140001` through `202611140011` are already present, adopt that reviewed baseline once:

```bash
sudo docker compose --env-file .env.production -f compose.production.yaml stop api
sudo docker compose --env-file .env.production -f compose.production.yaml run --rm --no-deps api node scripts/migrate.mjs --baseline-through 202611140011
```

That command records the baseline, performs basic schema probes and applies later migrations, including `202611140012_production.sql` (OAuth data-use consent fields). Probes are safeguards, not proof of an arbitrary database's complete schema. If your schema level differs, inspect it and use its **actual** last applied version; do not force the example baseline. An existing ledger does not need or accept another baseline. Do not edit already recorded migration files. Checksums normalize CRLF to LF for Windows-to-Ubuntu transfers; legacy raw Windows checksums are upgraded only when the exact line-ending variant matches. SQL content changes still fail validation.

For a new, empty Supabase application schema, omit `--baseline-through`:

```bash
sudo docker compose --env-file .env.production -f compose.production.yaml run --rm --no-deps api node scripts/migrate.mjs
```

This assumes Supabase's existing `auth.users`, `auth.uid()`, `anon` and `authenticated` roles. It is not an instruction to create a replacement database or drop existing tables.

## 5. Launch and HTTPS

After DNS resolves correctly, Google/Supabase URLs are configured and the old worker is stopped:

```bash
sudo docker compose --env-file .env.production -f compose.production.yaml run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile
sudo docker compose --env-file .env.production -f compose.production.yaml up -d --wait --wait-timeout 180
sudo docker compose --env-file .env.production -f compose.production.yaml ps
bash scripts/smoke-production.sh
```

Caddy obtains and renews certificates automatically when DNS, reachability and ACME requirements are satisfied. It redirects HTTP to HTTPS. Certificates are persisted; do not remove the volumes on updates. The API trusts one proxy hop because its container port is not published. CORS allows only `WEB_ORIGIN`; clinic cookies are host-only HttpOnly/Secure/SameSite=Lax. Both configured HTTPS domains share `netawaz.pk`, allowing the credentialed clinic requests to the API. The clinic API still validates Origin and its request header for writes. OAuth state/PKCE/browser cookies remain independent of clinic/admin authentication.

## 6. Acceptance checks

- `/` shows the public website; public Login opens `/status`.
- Privacy, Terms, Data Deletion and Support load in a signed-out browser. Check the operator contact and approved backup disclosure.
- Anonymous `/admin` redirects to `/admin/login`. A clinic cookie/password cannot open the workspace. An authorized Supabase admin can sign in, refresh the page, switch businesses and sign out.
- Create/reset a **test** clinic login through an authorized admin. Test Online/Offline, connection status and appointment hours on `/status`; check both cookies and rejected cross-origin writes.
- Use two test clinics to verify Calendar/WhatsApp isolation. Existing isolation tests run against an embedded database; they do not replace a staging HTTPS test.
- Demonstrate Calendar authorization, calendar selection, slot availability, explicit confirmation, one event creation, uncertain-result handling and disconnection using a test calendar. Do not use patient data in a demo.
- Test revocation in Google Account settings and the subsequent reauthorization status. Then reconnect deliberately.
- Test actual WhatsApp receipt/reply, human handoff and unread marking on test numbers, including after a controlled API restart. The production health endpoint reports service readiness, while per-clinic `/status` reports individual connections.
- Confirm `robots.txt` and `sitemap.xml` contain only intended public discovery links. Private pages also have noindex headers/metadata; robots rules are not access control.
- Restore an encrypted backup into an isolated staging environment before treating backup recovery as verified.

## 7. Updates and rollback

Make a verified backup, preserve `.env.production` and the encryption key, retain the previous image tag/digest, and update source from a reviewed release. Set `RELEASE_TAG` to the release identifier, then:

```bash
cd /opt/codetic
sudo bash scripts/deploy.sh
bash scripts/smoke-production.sh
```

The script validates config, builds images, checks release gates, stops the API, applies only new migrations, then starts the stack. If migration fails, it stops rather than silently changing schema assumptions; review the failure before restarting. Deploy during a maintenance window: restarting briefly interrupts transport. The persisted inbox and encrypted sessions support recovery, but an external send with an uncertain result is deliberately not blindly replayed.

For application rollback, restore the previous source/release tag and images only if compatible with the current schema. No destructive automatic down migrations are provided. Database recovery is a separate, operator-reviewed provider restore, preferably staged first. Do not delete application tables or run `docker compose down -v` as an update strategy.

## 8. Encrypted backups and recovery

Use the Supabase/provider backup capability appropriate to the actual plan, plus an access-controlled offsite backup if needed. Record the real frequency, retention, encryption, deletion-request handling and restore owner in the production disclosure. Verify provider coverage of Auth users; restoring into a different project also requires reviewing Supabase URLs/keys and OAuth settings.

An optional application-schema backup helper is included. Install compatible PostgreSQL client tools (at least the server major version), Node 22.12+ and `age` on the backup runner. Store the age **private** identity offline; only its public recipient is needed to create backups. Use a protected environment file and invoke the script without placing database credentials in command arguments:

```bash
# On the protected backup runner, with the repository dependencies installed:
# DATABASE_URL, DATABASE_SSL_CA_FILE, BACKUP_AGE_RECIPIENT and BACKUP_DIRECTORY
# must be available via a mode-0600 .env or injected environment.
node scripts/backup.mjs
```

The helper pipes a custom-format `public` + `codetic_ops` dump directly into age encryption. It does not write an unencrypted intermediate dump, upload backups, define retention or include the encryption key/Auth users. Configure scheduling/offsite transfer/retention separately and verify the complete managed backup too. Partial encrypted files after failed backups are not successful backups.

For a staged application-schema restore, stop all workers and use an already restored/compatible Supabase project with the matching Auth users. Pipe `age --decrypt -i PRIVATE_IDENTITY BACKUP.dump.age` to `pg_restore` using protected `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGSSLMODE=verify-full` and `PGSSLROOTCERT` environment values. Have the operator review restore flags/schema ownership before execution; no overwrite command is automated. Restore the **same** application encryption key, reconcile Google/WhatsApp connections and ensure deleted data is not reintroduced from backups. Rehearse this on staging, not the only production database.

## 9. Logs and monitoring

```bash
sudo docker compose --env-file .env.production -f compose.production.yaml logs --tail 100 api
sudo docker compose --env-file .env.production -f compose.production.yaml logs --tail 100 caddy
curl --fail https://api.netawaz.pk/ready
```

API request logging redacts authorization/cookies/bodies, strips queries and redacts Calendar invite tokens in paths. Errors expose categories instead of raw provider responses. Caddy has **no access log** and its default/error logger removes request URIs and request headers; do not enable URI access logging or proxy debug logging for OAuth/invitation traffic. Caddy routes the compatibility `/calendar/*` web paths directly to the API, bypassing Next access logging. Container logs rotate by size (10 MB × 3 per service), not by a claimed day-based retention. Restrict Docker/host log access. External uptime alerts and disk/backup monitoring still need operator configuration; Docker restart policies do not repair a powered-off VPS or an upstream outage. Never paste operational logs containing customer information into public issues.

## Local development

Keep the existing `.env` and `apps/web/.env.local`. Run the existing Node-22 `npm run dev` and `npm run dev:web` commands. Homepage is public; admin moves to `/admin/login` and `/admin`. Retain the exact existing localhost callback URI in the **same Google Web OAuth client** if development is still needed. Local OAuth requires explicit `CALENDAR_ALLOW_LOCAL_OAUTH=true`; production refuses that setting. Do not commit real `.env` files.

## Release blockers and verification limits

Before public release: real DNS/VPS/HTTPS verification, protected secrets and preserved key, reviewed backup retention plus restore drill, AI-provider processing/Limited Use review, operator approval of legal/deletion practices, Google project/domain/consent configuration and review submission, and an end-to-end staging test. The unofficial WhatsApp integration also requires the operator to review WhatsApp terms and operational/account risks; no official WhatsApp partnership or delivery SLA is claimed.

Compose syntax and native production builds can be checked without a running Docker engine. A successful native build is **not** proof that these images have been built or booted on Ubuntu; run the build/start/Caddy validation commands above with Docker running. No VPS deployment, live certificate issuance or Google approval is claimed by this repository change.

## Automatic deployment

For the existing VPS and Cloudflare Tunnel setup, use [CICD.md](CICD.md). Its one-time setup enables validated main-branch deployment and service-specific updates while preserving the local Compose override and secrets. After adopting CD, use its three-file Compose command for manual app operations instead of the earlier whole-stack deploy helper.
