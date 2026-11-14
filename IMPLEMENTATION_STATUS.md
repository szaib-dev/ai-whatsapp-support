# Implementation status

## Dashboard, memory and batching � completed 2026-11-14

Completed the interrupted dashboard redesign with responsive desktop/mobile layouts, separate business management, real activity metrics, inbox, customer memory, connection controls, and reviewed knowledge publication. Verified local sign-in and live conversation history in the browser, including mobile navigation without horizontal overflow.

Incoming private messages are persisted before processing. A 2.5-second quiet window (10-second maximum, 20 chunks/8,000 characters) groups each customer's messages in order; four customers can process concurrently. Pending rows survive restarts; uncertain deliveries require review rather than replay. Explicit customer names are saved with provenance and a 30-day expiry; recent conversation context is bounded to 30 days and 60 messages. Older messages remain in the database; expiry excludes them from AI context rather than deleting records. The inbox shows up to 100 recent messages. Full 30-day history is not loaded into every AI prompt.

Validation: 62 tests passed (one opt-in live-lock test skipped), backend type check and lint passed, production frontend and backend builds passed. Chunk grouping, concurrency, uncertain sends, memory expiry and customer separation have regression coverage. Automated tests use isolated embedded databases; live phone chunking is still a separate manual check.

## Delivery lock correction

Reproduced a live database lock conflict: delivery held `FOR UPDATE` on the WhatsApp account while Signal-key persistence needed a foreign-key `KEY SHARE` lock on the same account. Replaced the delivery lock with `FOR NO KEY UPDATE`, which still serializes account status changes and permits credential writes. The opt-in `tests/live-lock.test.ts` reproduces the old timeout and verifies the corrected lock against Supabase; writes are rolled back. Message processing errors no longer disconnect an otherwise authenticated socket. Real customer delivery remains separately verified through outgoing provider IDs, never by replaying uncertain sends.

## Automatic replies by default — latest behavior

At the user's request, a new connected account now responds without knowledge setup. Tenant-scoped default context, basic conversational replies, safe missing-detail responses and provider-failure acknowledgements work before publication. Detailed facts still come only from the organization's published answers. Missing knowledge no longer automatically puts conversations in human mode, and phone-originated messages no longer silently disable automatic replies. Explicit pause, takeover, opt-out and tenant validation remain enforced. The existing local workspace's automatic replies were enabled through an audited new revision. No customer message was replayed or sent as a development test.

## WhatsApp and owner setup follow-up — 2026-11-14

- Provisioned the requested owner account and Codetic AI workspace; temporary login is in an ignored local file, with password changes available through Account.
- Added owner-only account creation, connection controls, live expiring QR display, encrypted PostgreSQL credential/Signal-key storage, session-bound transport delivery, bounded reconnect, restart restoration and staff-message takeover.
- Applied the second migration to whatsapp-support: credentials are server-only and RLS-protected; paired identities are unique. Generated the local encryption key without exposing it.
- Verified real Supabase password sign-in, owner membership API access and receipt of an actual WhatsApp pairing QR. The phone scan and real inbound/outbound messages still require the user's phone and have not been verified. No published clinic knowledge or customer messages were fabricated.
- 51 automated tests pass, including encryption tampering/context substitution, owner/tenant authorization, credential table permissions, transport event handling, identity mismatch, QR expiry and reconnect/logout behavior.
- Backend/frontend type checks, lint, optimized frontend and backend builds passed. Production dependency audit: zero vulnerabilities. Docker runtime and phone-based delivery remain unverified.

Earlier pending-feature statements about the Baileys adapter and no live Auth testing are superseded by this follow-up. Appointments, automated memory capture, phone-number pairing, deployment and full phone-based end-to-end verification remain pending.

## Local connection follow-up — 2026-11-14

- Connected the configured `whatsapp-support` project using its CLI-provided session pooler and verified TLS with the Supabase CA.
- Confirmed its public schema was empty, then applied `202611140001_isolation.sql` in a transaction. Verified all 12 application tables have RLS enabled. Drone Job Board was untouched.
- No Auth users existed at setup time. Sign-in requires creating an Auth user and provisioning clinic owner membership; no credentials or clinic facts were invented.
- Reran all 40 tests, backend/frontend type checks and lint successfully after adding optional database CA file configuration.

The original implementation report below records the earlier delivery state; its statements that no live migration occurred are superseded by this follow-up.

The workspace initially contained only .git. This delivery establishes the tenant-isolated knowledge-management architecture; it does not claim the entire supplied six-phase MVP is complete.

## Implemented

- Next.js App Router/TypeScript/Tailwind dashboard; Supabase password sign-in; memberships and organization selection; separate knowledge/config editor, revisions, owner publication, document review, audit view, conversation history, customer memory display/deletion and takeover controls.
- Fastify API with validated bodies, verified bearer authentication, exact-origin CORS, rate limiting, safe error responses and server-side tenant authorization. No service secrets in the client.
- Initial SQL migration: organizations, memberships, WhatsApp session bindings, contacts, conversations, messages, customer memories/provenance, immutable knowledge revisions, publications, processing claims, audit events; tenant indexes, composite FKs, RLS and read-only browser privileges.
- DeepSeek HTTP integration with timeout, JSON response validation, bounded context and a constrained published-answer selector. AI cannot emit arbitrary factual text. Missing answers and provider failures escalate without sending fabricated content.
- Trusted-transport pipeline: verified/frozen bindings, re-resolution on each event, tenant/context validation, opaque LIDs and phone JIDs, private text filtering, bounded in-process queues, duplicate claims, original-socket sends and final state rechecks.
- Docker/Compose isolation and development/deployment/security documentation. No existing Supabase project or VPS service modified.

## Verification

Automated suites cover context mismatches, Revive/Zorro prompt separation, same customer identifiers across tenants, unauthorized/forged API access, approval permissions, unpublished FAQs, missing pricing, prompt injection boundaries, binary/oversized uploads, duplicate events, AI outage, takeover, immutable bindings/revisions, cross-tenant FKs and real PostgreSQL RLS.

Verified on 2026-11-14 using Node.js 22 via npm exec (the host default is Node 20):

- `npm test`: **40 tests passed**, 3 suites. Includes real SQL delivery checks for takeover/disconnection and persistence of the actual provider message ID.
- `npm run typecheck`: passed, backend and frontend.
- `npm run lint`: passed.
- `npm run build`: passed, optimized Next.js build and backend TypeScript compilation.
- Full dependency audit after the minimatch override: **0 vulnerabilities**; production-only audit independently passed with 0 vulnerabilities. The override updates a development-tool transitive dependency and lint was rerun against it.
- Docker runtime checks unavailable: Docker Desktop Linux engine pipe does not exist. Image build, Compose runtime, CPU/memory caps and healthcheck have not been verified in Docker.
- No live Auth sign-in, browser end-to-end interaction, DeepSeek call, WhatsApp connection or deployment was tested.

## Pending (not working features)

- Baileys adapter, real QR/phone pairing, encrypted durable credentials and Signal-key persistence, restart restoration, reconnection/backoff and phone-app staff-message detection. The pipeline is currently callable only by trusted integration code/tests, not a connected transport.
- Automated long-term memory capture/correction, consent/privacy basis, medical-data minimization, opt-out/deletion/retention workflows and exports. Existing memory can be read/deleted; this is not a complete customer-memory product.
- Appointment capture/confirmation workflow, staff sends, contact management, platform-admin provisioning UI, invitation/access administration, AI sandbox, spending/token metering and request budgets.
- PDF/DOCX import (only bounded plain UTF-8 TXT/Markdown supported), upload source retention and richer document extraction/review workflow.
- Debounce, bounded reconnect/retry policy, multiprocess queue capacity controls, operational alerting and end-to-end browser interaction tests.
- Live Supabase Auth/managed RLS, DeepSeek and WhatsApp verification; Docker image runtime verification; production migrations/deployment. Credentials/authorization were not requested because these unfinished release features must be completed first.

## Run checks

Use Node.js 22+: `npm ci`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm audit --omit=dev`.


## Dashboard controls follow-up — 2026-11-14

Added owner unlink and removal controls (credentials erased, account hidden, history retained), configurable per-business batching delay/max wait, and authenticated staff replies with duplicate-request protection and explicit staff takeover. Removal releases the active phone-identity uniqueness constraint. Added migrations 004 and 005 to the local configured Supabase project.

Fixed missing activity, settings, language and memory layouts. Knowledge now uses questions/answers and Save & activate, with explicit import and version explanations. Session restore has a timeout, shared browser Auth client, workspace retries and visible loading/error recovery. Simple intents and exact reviewed questions bypass remote inference; provider timeouts are bounded. Failures known to precede delivery have capped safe retries; uncertain sends are not replayed.

65 tests pass (one opt-in live-lock test skipped). Type checks, lint and frontend production build pass. Browser verification covered workspace recovery, activity spacing and editable timing controls. Live phone latency, logout and manual staff delivery require phone verification; mocked transport tests verify request idempotency and takeover.

## Live no-reply diagnosis — 2026-11-14

The user's published configuration had aiEnabled=false despite a connected account and active conversations. Enabled replies through a new audited revision without changing business answers or replaying old messages. Verified a fresh live Hello: durable inbox timestamp 08:40:14.506 UTC, persisted incoming message 08:40:18.088 UTC, outgoing AI message recorded sent with provider ID at 08:40:19.878 UTC (5.372 seconds from inbox receipt). Added prominent business-level OFF warning/enable control and explicit Save with replies OFF labeling. 65 tests, type checks, lint and production build pass.

## Seen, typing, hours and reply speed — 2026-11-14

Added best-effort incoming-message read receipts after approximately one second, and composing presence for enabled active conversations. Presence never blocks inbox persistence; it stops after sending or after a bounded timeout. A fast reply suppresses later typing. Reconnected the local API with this behavior and verified connected status and enabled AI.

Explicit opening/closing AM/PM times in the saved published description now answer hours questions directly. Verified the live description yields 11:30 am to 5:30 pm; current-open status and unspecified days are not inferred. Added a dedicated Reply timing navigation page with Instant/1/3/5-second presets, custom seconds, and Apply timing. Browser verified all controls. 67 tests pass, plus focused receipt/presence/hour tests after final typing cleanup; types, lint and production build pass. Phone-side display of typing/read indicators remains dependent on WhatsApp delivery/client settings and needs a phone check.

## Rules-based conversations and live updates — 2026-11-14

Replaced the multi-tab question/import/version editor with a single business-rules editor, explicit reply language and Save rules & activate. Removed Import text from the dashboard. Existing descriptions, old answers and prior saves remain in storage. Owner facts/rules, language, bounded tenant history and customer memory are now passed to DeepSeek for conversational replies; generated replies are no longer restricted to exact answer selection. System instructions constrain unsupported factual claims and medical/booking promises, but model output is generative and needs ongoing review. Missing provider responses use localized fallbacks. Current-day opening status is not inferred from hours alone.

Added committed PostgreSQL change notifications and an authenticated workspace SSE stream with membership checks, reconnect and polling fallback. Does not require Supabase Realtime publication. Concurrent requests share token verification; membership remains checked per request. Added real workspace dropdown, token-scoped in-memory connection prefetch/cache and immediate post-save state updates. Obsolete generation is suppressed when additional chunks are pending for the same customer; next batch uses recent conversation history.

71 tests pass; types, lint and frontend/backend build passed. Verified live authenticated SSE receives a database commit event. Verified actual DeepSeek Roman Urdu greeting and acknowledgement responses (~1–2 seconds provider time, not full WhatsApp latency), and browser switching between both businesses plus the simplified editor. Cold loads still need network requests. No customer messages were replayed for testing.

## Google Calendar connection and appointment scheduling — 2026-11-14

Implemented Connections → Google Calendar, private 24-hour single-use invite links, a separate public clinic approval page, OAuth state/browser binding and PKCE, verified Google identity, encrypted refresh credentials and server-only/RLS-protected calendar tables. No dashboard membership is created by approval. Primary calendar is selected by default; owners can select another writable calendar, revoke invitations, disconnect and set timezone/weekdays/hours/appointment duration.

Assistant scheduling is optional and off until the owner reviews and enables the schedule. Customers receive a specific slot and must send a short explicit confirmation code. Before creation the server revalidates the tenant/conversation/AI state, expiry, opening hours, local overlapping reservations and Google free/busy. Google event IDs are deterministic; confirmed duplicates do not insert again. Ambiguous writes are reconciled by event ID or retained as uncertain without automatic resending. Only verified Google creation results produce a booking confirmation. Existing events are not automatically rescheduled/cancelled; email guest invitations and Meet links are not implemented.

Applied migration 007 to the configured local Supabase project. Installed google-auth-library and luxon. All 81 tests pass (one opt-in live-lock test skipped); backend/frontend types, lint and production frontend/backend builds pass. Tests cover invite expiry/replay, wrong-browser callback, encryption, tenant authorization, RLS, timezones/opening hours, conflicts, duplicate confirmations, expired codes, staff takeover and uncertain external writes. Google endpoints are mocked. Browser verified the real setup-required Calendar panel.

Live consent and calendar creation are blocked by missing public HTTPS API URL and Google OAuth client credentials, which the user confirmed are not set up. No Google account has been connected, no real calendar event has been created, and no customer messages were replayed. Follow CALENDAR_SETUP.md for activation and a first live test with a dedicated calendar.

## Written language and tone rules — 2026-11-14

Removed the separate reply-language and tone selectors from the business editor. The live conversational prompt now uses written owner rules for language/tone, matching the customer when unspecified, and no longer injects legacy tone/language settings. Common explicit written language directives take precedence in deterministic fallback and appointment replies too; legacy fields remain in saved revisions for compatibility. Updated the rules outline and help text. 82 tests pass, including conflicting legacy-versus-written rule coverage; types, lint and production builds pass.

## Owner Online/Away mode — 2026-11-14

At the user's explicit choice, added the safe manual Online/Away mode under Connections → WhatsApp. Main-phone app-open/closed status is not reliably exposed by the linked-device protocol; connection.update.isOnline is deliberately NOT treated as phone availability. Unknown/Online holds AI work; explicitly selecting Away releases unread/unanswered pending messages. Current Codetic AI workspace has this mode enabled and its live number was set to Online through the verified browser control. Other businesses retain their individual settings.

Phone-synced incoming read receipts, explicit chat-read updates and outgoing phone messages persist handled markers/watermarks. Customer reads of our outgoing messages are ignored; our own generated outgoing IDs and stored AI/staff sends are excluded from phone-activity classification. Recent observed phone reads/replies mark owner Online; old synced replies can suppress older handled messages without claiming the phone is currently online. These signals depend on delivery by WhatsApp and are not guaranteed phone state detection.

Owner mode disables the bot's automatic read receipts while waiting, preventing bot-generated seen events from being mistaken for human reads. Incoming messages are stored immediately for dashboard visibility. Eligibility is checked when dequeuing and again before sending; deferred work is requeued without consuming failure attempts or retaining a duplicate-processing claim. Calendar confirmation also checks owner availability.

Applied migration 008. Fixed the existing CORS configuration to allow browser PATCH/DELETE requests; a real status-switch click exposed the missing methods, and browser save was retested successfully. All 90 tests pass (one opt-in live-lock test skipped), types/lint/build pass. Live phone read/reply synchronization remains a separate device verification step. No queued customer messages were deliberately replayed as a development test.

## Restricted clinic status portal — 2026-11-14

Implemented `/status` as a separate clinic email/password login with Online/Offline controls only. Owners set/reset/disable access under Connections → WhatsApp → Clinic status-page login. No Supabase user or workspace membership is created. Portal cookie sessions cannot access the Bearer-authenticated dashboard APIs, rules, Calendar settings or credential-management endpoints.

Passwords use salted scrypt hashes; sessions are random, stored hashed, seven-day HttpOnly cookies with Secure on HTTPS. Exact-Origin/custom-header checks protect mutations. IP throttling and account failure lockout limit login attempts. Admin access changes revoke all sessions; credential-version checks prevent concurrent old-password login from surviving a reset. New login/session tables are RLS-protected and inaccessible to browser database roles. Added migration 009 to the configured Supabase project.

95 tests pass; types, lint and production frontend/backend builds pass. Browser verified actual cross-port cookie login, Online/Offline saves, sign-out and owner credential controls using a disposable empty test clinic; the test clinic, credentials and sessions were removed afterward. No real clinic login was invented or enabled. Clinic users must receive administrator-set credentials. The local URL is http://localhost:3000/status; external clinic use requires the deployed web URL. See STATUS_PORTAL.md for setup and deployment requirements.

## Calendar web-origin 404 correction — 2026-11-14

Confirmed the supplied approval link returned Next.js 404 on port 3000 while the same path returned Connect Codetic AI on API port 3101. Added web-server rewrites for every `/calendar/*` path, preserving form submissions, query strings, callback cookies and the configured public redirect origin. Added the internal API upstream setting to the web environment example and setup guide. Verified HTTP approval 200, invalid start handled by the API, callback handled by the API, successful production build, and browser display of Connect Codetic AI / Continue with Google. Did not submit Google consent or consume the user's invitation.

## Clinic portal scheduling and connection-page cleanup — 2026-11-14

Expanded restricted `/status` access with an Appointments tab for the business's own timezone, bookable weekdays, opening/closing times, appointment duration and automatic-booking switch, plus recent appointment requests. New portal endpoints use the existing clinic session, exact-Origin checks, strict schemas and a fresh enabled-session check under lock before saving. They expose no Google tokens, login settings, other businesses or calendar-binding changes. Shared schedule validation now applies to owner and clinic saves.

Separated Connections into WhatsApp, Google Calendar and Clinic portal tabs. Moved status-login management into Clinic portal and booking-hours management into `/status`. Calendar now visibly distinguishes Google connected from Booking ON/paused, with a direct portal link and collapsed advanced connection management. The initial no-booking response was traced to booking_enabled=false despite a connected calendar; the assistant now describes a paused booking service without claiming Google is unconnected.

97 tests pass (one opt-in live-lock test skipped), types/lint/build pass. Browser tested clinic login, editing times/days, enabling and saving booking against a disposable no-Google/no-phone fixture, then removed the fixture and signed out. Real schedule settings were not changed by the test. Final browser observation showed the real Calendar connection with Booking ON and saved 09:00–17:00 / 30-minute settings; clinics should review actual working hours in `/status`. Automatic replies still respect Online/Offline availability. No real appointments were created as development tests.

## Conversation routing and recovery (14 November 2026)

Booking intent is resolved from the latest message before slot extraction. Calendar-reporting questions do not read private calendar contents or start new bookings. A bare date/time can resume a pending booking across side questions; unrelated questions, greetings, and abandoned or completed bookings cannot become slot answers. The extractor receives only relevant customer booking turns and identifies which detail is missing.

Message history is scoped to the exact conversation before its limit is applied. Current batch messages are supplied separately, future messages and unsent assistant messages are excluded, and customer profile memory remains available. Responses are checked against the last delivered assistant reply; persistent repetition escalates to staff instead of looping.

A staff handoff delivers one localized final notice and changes the conversation to human mode in the delivery transaction. Further AI replies stay paused until staff resumes the assistant in the inbox. If delivery is uncertain, the conversation stays paused for staff review.

Both Connections and the clinic portal Connection tab offer Disconnect WhatsApp. This stops automatic recovery without deleting saved pairing credentials or chat history. Clinics can reconnect their own number without dashboard access.

Staff handoffs now queue a WhatsApp “mark as unread” operation after the final notice is delivered and human mode is saved. Unread operations retry independently after connection failures or API restarts without resending the notice. Phone read/reply activity acknowledges pending markers. This notification queue is private to the backend and scoped by business, account and conversation.

With no explicit owner language rule, replies match clear incoming English, Roman Urdu or Urdu. Neutral greetings, acknowledgements, times and confirmation codes inherit recent customer language; absent useful history they default to English. The conversational prompt uses customer history to maintain tone without copying prior assistant mistakes. Explicit owner rules continue to apply.
