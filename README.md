# Codetic AI

Multi-clinic WhatsApp customer support with business-specific AI rules, staff handoff, a separate clinic portal and confirmed Google Calendar appointment booking.

## Local development

Use Node **22.12+** and the repository npm lockfile:

```sh
npm ci
npm run setup
```

Fill the ignored root `.env` and `apps/web/.env.local` with the existing project values. Never put a Google secret, database URL, encryption key or service-role key in `NEXT_PUBLIC_*`. Preserve the existing `SESSION_ENCRYPTION_KEY`; replacing it breaks saved connections.

```sh
npm run dev
# In a second terminal:
npm run dev:web
```

- Public website: `http://localhost:3000/`
- Clinic portal: `http://localhost:3000/status`
- Administrator sign-in: `http://localhost:3000/admin/login`
- Protected dashboard: `http://localhost:3000/admin`
- API: `http://localhost:3101`

The original dashboard functionality remains in the protected admin route. Public Login opens the clinic portal. Supabase administrator identity plus workspace membership (or an explicitly configured bootstrap user UUID) is checked by the server. Clinic credentials are separate and do not grant dashboard access.

Use the migration procedure in DEPLOYMENT.md for the **existing** database. Do not replay the initial CREATE TABLE migration into an existing project or create a replacement database. Local Calendar callback origins still work when explicitly registered and `CALENDAR_ALLOW_LOCAL_OAUTH=true`.

## Production deployment

Read [DEPLOYMENT.md](DEPLOYMENT.md) for exact Ubuntu 24.04, DNS, environment, database migration, Caddy HTTPS, backup, update and restore instructions. Use `compose.production.yaml`; the original `compose.yaml` is a development API-only helper. The production stack preserves Supabase/PostgreSQL and stores connection credentials/queues in the database. One WhatsApp manager is permitted for a database; stop the old local worker before moving it to the VPS.

- Website: `https://codetic.netawaz.pk`
- API: `https://api.netawaz.pk`
- Google callback: `https://api.netawaz.pk/calendar/oauth/callback`

Operator contacts are configurable and supplied as Shahzaib Mirza (operating under Codetic), Pakistan, `szaib.dev@gmail.com`. Production intentionally requires an actual backup-retention description and approval of legal disclosures/provider data-use terms. No Google verification, compliance certification, official WhatsApp affiliation or uptime guarantee is claimed.

## Behavior and data handling

Each business has separate authorized accounts, knowledge, conversations and calendar connection. The assistant uses DeepSeek for conversational replies and date/time extraction. A customer must explicitly confirm a proposed slot before a Google event is created; deterministic event IDs and uncertain-result handling reduce duplicate creation. Staff handoff pauses AI and queues an unread marker in WhatsApp. Clinic Online/Offline is a manual reply setting and is not phone-presence detection.

Saved WhatsApp authentication and Google refresh credentials are encrypted with AES-256-GCM/context binding; messages and general calendar metadata are not separately field-encrypted. Conversation records persist until manual deletion; 30-day AI context/profile-memory expiry is not a database purge. Customer-authored messages and verified non-Calendar conversation context can reach the AI provider; Calendar-derived output is excluded by provenance. Public policies disclose the actual processing and operator-assisted deletion process.

## Validation

```sh
npm test
npm run typecheck
npm run build
# Template-only validation (no secrets printed; Docker engine not required):
docker compose --env-file .env.production.example -f compose.production.yaml config --no-env-resolution --quiet
```

[GOOGLE_VERIFICATION_CHECKLIST.md](GOOGLE_VERIFICATION_CHECKLIST.md) covers scopes, branding, verified domains, redirects, consent, demonstration and external approval steps. [PRODUCTION_AUDIT.md](PRODUCTION_AUDIT.md) records findings/changed file groups. [CALENDAR_SETUP.md](CALENDAR_SETUP.md) and [STATUS_PORTAL.md](STATUS_PORTAL.md) explain integration and clinic usage. Real HTTPS, provider approval, phone sync and restore drills must be verified on staging; unit tests/native builds do not establish those external outcomes.

## Automatic deployment

For the existing VPS and Cloudflare Tunnel setup, use [CICD.md](CICD.md). Images build sequentially on GitHub-hosted runners and stream over SSH, with disk checks and scoped image cleanup retaining rollback images. Its one-time setup enables main-branch deployment and service-specific updates while preserving the local Compose override and secrets. After adopting CD, use its three-file Compose command for manual app operations instead of the earlier whole-stack deploy helper.
