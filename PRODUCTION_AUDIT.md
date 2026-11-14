# Production preparation audit

## Architecture inspected

Next.js 16/React web application; Fastify API; Supabase Authentication for administrators; custom scrypt/HttpOnly-cookie clinic portal; PostgreSQL application data and RLS; Baileys linked-device transport with encrypted database-backed auth, advisory singleton lease and recovery watchdog; durable inbox/dispatch pipeline; DeepSeek response and appointment-time extraction; Google server-side OAuth/PKCE, scoped refresh credentials, free/busy checks and confirmed deterministic event creation. SQL migrations, local scripts, existing Compose/Docker setup and regression tests were reviewed. No database/provider replacement was introduced.

## Verified issues addressed

1. Root route was the client dashboard/login. Moved the existing dashboard client into `/admin` and added public presentation/legal routes. Public Login points to `/status`.
2. Dashboard route had only a client session check, although its APIs already verified Supabase identity and tenant membership. Added a server-checked HttpOnly admin cookie and server-render route gate, verified through an API membership/bootstrap check. Unassigned Supabase users cannot create a workspace to bypass the new admin gate. Per-business owner/staff permissions remain in existing API transactions.
3. Original Docker deployment included only the API. Added a standalone Next container, a three-service private-network Compose stack, Caddy HTTPS/certificate volumes, health checks, logs, release validation and update/backup/migration tooling.
4. Production URLs and policy approval were not validated. Added HTTPS-origin, local-OAuth, database/session-mode/TLS, public-key, key-length and release-gate checks. Development remains explicitly supported.
5. Calendar access cache was keyed only by organization. A refresh in flight during reconnection could reintroduce an access token for the previous Google credential. Cache entries now bind the encrypted credential, refresh results are rechecked, rotated refresh credentials can be saved, and rejected cached tokens mark only the matching connection for reauthorization.
6. Calendar connection page did not prominently disclose administrator/AI processing. Added public policy links and affirmative production data-use consent; migration 012 records consent timestamp and disclosure version with the flow. Existing OAuth client/scopes, private-link isolation and booking confirmation mechanisms are retained.

## Actual privacy boundaries

- Refresh tokens, PKCE verifier and WhatsApp auth are application-encrypted with AES-256-GCM/context binding. Access tokens are cached in memory. Messages/calendar metadata are not field-encrypted by this application.
- Invites/state/browser secrets are hashed; clinic passwords are salted scrypt hashes. Production cookies use HttpOnly/Secure; CSRF and same-origin checks are retained.
- AI receives clinic rules, customer messages, bounded recent history and profile context. Appointment extraction receives relevant booking messages and timezone. Calendar-derived appointment replies can occur in later conversation prompts. Raw unrelated Google event lists and auth tokens are not sent to AI. This derived-data transfer needs appropriate consent/provider terms and Limited Use review; code cannot verify a provider agreement.
- A 30-day context window/memory expiry is **not** automatic deletion of stored conversation/memory records. Most data persists until manual/operator-assisted removal. Public pages say so and do not invent a retention SLA.
- Calendar disconnect deletes stored connection/token/cache and cancels proposed requests; it does not delete existing Google events or historical appointment records. WhatsApp Disconnect preserves credentials/history; Unlink removes pairing; Remove hides the account and preserves history.
- Operator infrastructure/database access exists. No compliance certification, incorporated-company status, official WhatsApp affiliation, Google approval, automated full-account deletion or guaranteed uptime is claimed.

## Changed file groups

- Public site: `apps/web/app/(public)/`, `apps/web/lib/public-config.ts`, root layout, icon, OG assets, robots and sitemap.
- Admin routing: dashboard client moved from root, `apps/web/app/admin/`, `apps/web/lib/admin-session.ts`; clinic layout adds public policy navigation without changing clinic credentials.
- API: `config.ts`, `server.ts`, Calendar config/cache/routes; additive OAuth disclosure migration 012.
- Deployment: root API Dockerfile, web Dockerfile, `compose.production.yaml`, development Compose clarification, `deploy/Caddyfile`, `.env.production.example`, ignore rules, package scripts, migrate/deploy/smoke/backup/preflight scripts.
- Documentation: deployment, verification checklist, this audit, README and Calendar setup entry points.
- Tests: production configuration, administrator/consent authorization, calendar token cache isolation/races, plus all existing WhatsApp/booking/tenant regression tests.

No real secrets were copied to public source or changed, no Google events were created for this audit, and existing booking confirmation/free-busy/event-ID logic was preserved. External DNS/Google verification/provider contracts, VPS deployment and restore drills remain operator work. See the final task report for actual test/build results and infrastructure validation limits.
