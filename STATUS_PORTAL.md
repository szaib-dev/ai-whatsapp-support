# Clinic status page

Clinic URL: `/status` on the dashboard's deployed web address. In local development this is `http://localhost:3000/status`; localhost is not reachable by remote clinics.

## Administrator

Open **Connections → Clinic portal → Clinic portal access** for the selected business. Set a clinic email and password (at least 12 characters), enable access, and save. Share the status URL and clinic credentials privately. Do not reuse your administrator credentials. No real clinic credentials are created automatically.

Only dashboard owners can create/reset/disable the status login. Passwords are salted scrypt hashes and cannot be read back. Leaving the password blank on an existing login keeps it unchanged. Every saved access change signs out prior clinic sessions; disabling access blocks further sign-ins. Each login email belongs to one business.

## Clinic

Sign in on `/status`. The Availability tab provides Online, Offline and Sign out:

- Online pauses automatic replies for that business's numbers.
- Offline makes unread/unanswered queued messages eligible for automatic replies.
- Availability is a manual reply setting, not a reading of WhatsApp presence. Phone-synced read/reply events exclude handled messages but never change the selected mode. Opening or closing WhatsApp or the portal does not change this setting.

The Appointments tab lets the clinic configure its own bookable days, opening/closing times, timezone, appointment length and automatic-booking switch, and view recent appointment requests. Calendar connection setup and calendar selection stay with the administrator. Google being connected and automatic booking being active are separate states.

The page lists only this business's linked numbers, availability, appointment schedule and customer phone-number privacy controls. It does not expose conversations, customer message data, business rules, Calendar credentials, account management or dashboard access. Password changes and resets must be requested from the administrator.

## Sessions and deployment

The portal uses a separate, hashed server-side session with a seven-day HttpOnly cookie, not Supabase dashboard authentication. Admin resets, expiry and sign out invalidate sessions. Mutations require the configured web Origin and a custom request header. Login attempts are limited by IP and repeated failures lock the account temporarily. Login/session tables are server-only with RLS and no browser-role access.

Set `WEB_ORIGIN` to the deployed HTTPS web origin and `NEXT_PUBLIC_API_URL` to the API. Web/API hosts must be same-site (for example app.example.com and api.example.com) for SameSite=Lax session cookies, or reverse-proxy the API under the web origin. HTTPS enables Secure cookies. CORS permits credentials only for the configured web origin. Cookie authentication applies only to `/status-api`; it grants no access to Bearer-authenticated dashboard endpoints.

## Chat privacy

Open **Chat privacy** on `/status`. Search the phone-number list or enter a full international number (for example +923001234567), select **Stop**, and confirm. Numbers can be stopped before they contact the clinic. The list contains phone numbers and stop/allow state only, never names, message previews, message bodies or conversation history. The control applies to all WhatsApp accounts in that clinic and persists across reconnects, restarts and workspace switches. Online/Offline, conversation pause, handoff and administrator AI settings do not override a privacy stop.

After the stop is confirmed, future message bodies from that phone are ignored by application intake before normalization, persistence or AI/calendar processing. They are not added to conversations, inbox rows or profile memory; no app replies, read receipts or composing presence are generated for them. Only routing metadata (phone number and WhatsApp address aliases) is retained to enforce the policy. WhatsApp/the linked-device SDK necessarily still receives protocol traffic and may decrypt packets; this feature is not a network block or WhatsApp's own Block contact function. The clinic can continue chatting directly in its WhatsApp app.

A stop waits for already-started message processing to drain under a PostgreSQL exclusive privacy lease before confirming, then discards pending/non-completed inbox work and pending unread handoff markers for excluded identities. It cannot recall data already sent to an AI provider or a reply already sent before the stop. Existing saved history/appointment records are kept; use the deletion process separately when those need removal. **Allow number** permits future messages again. Last-stop cutoffs reject older in-memory batches or delayed inbox messages after allowing, so messages ignored during the stop are not replayed.

WhatsApp sometimes provides a LID instead of a phone number. The application resolves alternate phone metadata or the local Signal mapping, storing the association per clinic/account. If a sender cannot be resolved while any stop is active, its content is ignored conservatively rather than risk forwarding a stopped person's message. Resolving that sender to a different, allowed phone permits normal handling. This can temporarily prevent replies to an unknown sender; privacy takes priority over guessing.

The server checks policy independently at intake, inbox save/selection, store load, response generation and delivery. SQL triggers additionally reject stopped-message/inbox inserts as a backstop for direct writes and legacy application rollback. Policy/mapping tables have RLS and no browser-role access. The status session determines the clinic; requests cannot choose a foreign organization. Changes require CSRF checks and revalidate the enabled login inside the write transaction.

The additive migration is `202611160001_chat_privacy.sql`, included in the reviewed CI migration manifest. Production runs it through the existing deployment migration step. The existing direct/session-pooled PostgreSQL requirement remains: transaction pooler port 6543 is unsupported. A dedicated lazy pool (maximum six connections) holds privacy leases independently of the ordinary eight-connection query pool to avoid exhausting queries during AI/provider work; nested checks reuse a live lease. Lease loss aborts external AI requests and fails closed. Delayed callbacks must obtain fresh leases after the original one ends.

Automated tests cover number normalization, content-free transport rejection, delayed typing, aliases, tenant isolation, authorization/CSRF, no persistence/memory/provider invocation, unknown identities, resume cutoffs, database backstops, lease failure and re-entrant/delayed privacy locking. Embedded PostgreSQL tests execute real policy SQL; distributed-lock sequencing is simulated separately, rather than claiming a live VPS/Supabase verification.
