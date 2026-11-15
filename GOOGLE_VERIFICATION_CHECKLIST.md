# Google OAuth verification: Codetic AI

Status updated 16 November 2026: application live and CI/CD working, **not Google verified**. Use [GOOGLE_OAUTH_SUBMISSION.md](GOOGLE_OAUTH_SUBMISSION.md) for the current targeted review, exact scope justifications, Cloud submission fields, observed Cloudflare 1010 blocker and short video script. Older unchecked audit items below are historical guidance, not a claim the live deployment is still unconfigured.

## 1. Public URLs

- Homepage: `https://codetic.netawaz.pk/`
- Privacy: `https://codetic.netawaz.pk/privacy`
- Terms: `https://codetic.netawaz.pk/terms`
- Data deletion: `https://codetic.netawaz.pk/data-deletion`
- Support: `https://codetic.netawaz.pk/support`
- Public Login destination: `https://codetic.netawaz.pk/status`
- Admin demo sign-in: `https://codetic.netawaz.pk/admin/login`

Confirm each public page is reachable over HTTPS without authentication. The homepage explains the actual application and links Privacy/Terms. Neither the homepage nor public Login leads to the admin login.

## 2. Domain verification

- [ ] Verify ownership of `netawaz.pk` in Google Search Console using the project owner/editor account, with the DNS verification Google provides.
- [ ] Add the applicable authorized domain in Google Auth Platform Branding; review Google's current handling of subdomains under that verified domain.
- [ ] Point `codetic.netawaz.pk` and `api.netawaz.pk` at the VPS and verify certificates.
- [ ] Confirm the OAuth project owner/editor and required support/developer contact addresses are accessible to the operator.

## 3. Branding fields

- App name: **Codetic AI** (match UI and demo).
- Operator: **Shahzaib Mirza (operating under the brand Codetic)**, an individual, **Pakistan**.
- User support email / privacy contact: **szaib.dev@gmail.com**.
- Developer contact: an actively monitored address controlled by the operator; the supplied email can be used if appropriate.
- Homepage/Privacy/Terms: exact HTTPS URLs above.
- Logo: use the actual Codetic brand asset, without implying Google/WhatsApp endorsement.
- [ ] Review the consent-screen audience/publishing status and test-user list. Test-mode limitations and Google review are external configuration, not fixed by changing application code.

## 4. Exact scopes and reasons

The OAuth request remains in `apps/api/src/calendar.ts`:

| Scope | Use | Why retained |
| --- | --- | --- |
| `openid` | Verify the authorizing account subject using its ID token | Binds the connected Google identity |
| `email` | Verify/account-display email | Identifies which Google account approved the clinic link |
| `https://www.googleapis.com/auth/calendar.calendarlist.readonly` | `users/me/calendarList` with writable filtering | Find the primary writable calendar and allow selection of another writable/shared calendar |
| `https://www.googleapis.com/auth/calendar.events.freebusy` | `freeBusy` for the requested slot | Check availability without listing unrelated event contents |
| `https://www.googleapis.com/auth/calendar.events` | Insert an appointment; retrieve that application-created event after an uncertain insert | Supports the existing writable/shared-calendar feature and duplicate reconciliation |

No full-calendar management, ACL-editing or Drive scope is requested. `calendar.events` is broader than the actual create/reconcile operations; explain this honestly. `calendar.events.owned` would exclude shared calendars currently supported. `calendar.app.created` would require creating/restricting the product to app-created secondary calendars and would change existing behavior. Neither is silently substituted. Calendar-list and free/busy access serve distinct API calls; events access alone is not treated as permission for all these endpoints. Review scope classification in Google Cloud at submission time rather than assuming approval or a fixed review duration.

## 5. OAuth client URIs

- Web application client, existing `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
- Production redirect: **`https://api.netawaz.pk/calendar/oauth/callback`**.
- If required for existing development, retain the exact localhost callback configured there (for example `http://localhost:3000/calendar/oauth/callback` when the web rewrite is the public API origin, or `http://localhost:3101/calendar/oauth/callback` when using the API directly). They are different URIs: use the one matching local `PUBLIC_API_URL`.
- Authorized JavaScript origins, if needed in the Google console: `https://codetic.netawaz.pk`, `https://api.netawaz.pk`, and only explicit localhost origins needed for development. Server-side OAuth still depends on the registered redirect URI.
- [ ] Do not use wildcards, invitation tokens, clinic IDs or state values as redirect registrations.

## 6. Data access and protection explanation

The private link is capability-based, hashed, expires in 24 hours, and does not grant dashboard membership. Authorization uses state, PKCE and an HttpOnly browser-binding cookie; the verifier is encrypted and flow expires after ten minutes. Production requires the connection page's affirmative data-use consent; its timestamp and disclosure version are stored with the flow. A successful callback atomically consumes the invite and stores the organization-scoped Google connection.

Google refresh tokens are AES-256-GCM-encrypted using the existing server key with organization binding; access tokens are cached in backend memory and bound to the current stored credential. Replacing/disconnecting a connection invalidates that relationship. Invalid refresh authorization and rejected cached access tokens result in reauthorization status for the matching connection. No credentials are sent to browser responses or the AI provider. Production uses HTTPS and verified database TLS. Calendar metadata and conversation text are not separately field-encrypted by this app; do not describe them as such.

Available-calendar metadata is shown to authorized workspace owners. Free/busy checks are used for requested times. Event creation stores the time, title “Appointment” and internal booking identifiers, not the conversation body. The app reads its own created event to reconcile uncertain outcomes. Ordinary customers cannot ask the AI for a private event list or meeting count.

**External AI disclosure:** independently authored customer requests and approved non-Calendar context go to DeepSeek. Calendar metadata, availability, events, responses and confirmation state are excluded from AI prompts. Proposed/confirmed appointment times are shared with the requesting customer through WhatsApp/Meta as the disclosed, consented booking feature. Migration 013 records message provenance; legacy generated replies and unknown summaries are excluded rather than guessed safe. All AI entry points apply the same boundary. Do not paste private calendar exports into user-authored rules or messages. Provider contractual practices for customer data still require review; no Google approval or provider audit is implied.

## 7. Demo: connection, calendar selection and booking

Use an empty test Google Calendar, two test businesses and synthetic conversations. Obtain consent for any account visible in a recording. Do not show patient data, tokens, passwords, QR codes or private production links.

1. Show the public homepage and footer Privacy/Terms/Support links while signed out; public Login opens the clinic portal.
2. Sign in as a permitted administrator at `/admin/login`. Open one test business → Connections → Google Calendar.
3. Generate a private link. Open it in a separate signed-out browser profile to demonstrate no dashboard access is needed. Show the business name, prominent administrator/AI-processing disclosure, policy links and checkbox.
4. Select the checkbox, continue to Google, show the real consent screen/app identity/scopes, and approve access using the designated test user. Show the success page and the admin connection state. Blur sensitive identity details if required without obscuring the behavior under review.
5. Show the writable calendar list, choose the test calendar, configure timezone/weekdays/hours/duration and enable booking. Booking starts disabled after a new connection by design.
6. In a synthetic WhatsApp conversation, request a specific future time inside those hours. Show the availability check/proposal and that no event exists until confirmation.
7. Send `CONFIRM` with the provided code. Show one matching Google Calendar event, with the title/time matching the request. Show that replaying confirmation does not create a duplicate.
8. Demonstrate an occupied slot being rejected and a different clinic being unable to access the first clinic's settings or confirmation.
9. Show staff handoff, the separate `/status` schedule controls, and that clinic credentials do not authorize `/admin` or owner-only API settings.
10. Disconnect Google Calendar from the workspace. Show the local connection removed, booking unavailable, previous Google events retained, and Google Account third-party connections for separate OAuth revocation.
11. Revoke a test grant and demonstrate reauthorization status and deliberate reconnection. Do not edit or delete real appointments for the video.

## 8. Recording and submission

- [ ] Record the actual deployed HTTPS application, not only localhost or slides.
- [ ] Narrate how **each requested scope** is used, showing the relevant features and consent screen in the same recording.
- [ ] Use the submitted OAuth project's client and the same app name/homepage/policy links.
- [ ] Include end-to-end connection, selection, availability, explicit booking confirmation, duplicate prevention and disconnection.
- [ ] Review the recording for private tokens/queries, passwords, patient data and production invite links before uploading.
- [ ] Use Google's requested video-sharing format and give reviewers access through the Verification Center. Supply concise scope justifications and reviewer instructions/test access as requested. Do not share production administrator credentials.
- [ ] Submit through Google Auth Platform Verification Center; track reviewer requests. Do not label approval complete until Google actually approves it.

## 9. Outstanding release/policy issues

- [ ] Live deployment/CI is established. Independent public verification probes currently hit Cloudflare 403/error 1010; resolve the edge restriction before submission. See the current submission packet.
- [ ] Google Cloud domain ownership, branding, production audience/status, scopes and redirect URIs need operator configuration and verification.
- [ ] Confirm AI-provider terms and technical/account settings prohibit disallowed reuse of Google raw/derived data, including general-purpose model development, and support the disclosed retention/processing. If not, change the processing design/provider agreement before enabling production; do not set the release flag just to bypass the issue.
- [ ] Approve the actual conversation/manual-deletion and backup retention policies. Currently there is no automatic conversation purge, whole-clinic deletion UI or fixed deletion SLA. Operator-assisted removal and backup-restore deletion handling must be operationally ready.
- [ ] Confirm the controller/processor and cross-border arrangements appropriate to the clinics, operator and service providers. No HIPAA, GDPR, Pakistani-law certification or legal-advice claim is made by the code.
- [ ] Run real HTTPS auth, OAuth and test-device WhatsApp flows, container image builds, restart and restore tests. Native builds/embedded tests do not substitute for these.
- [ ] Review unofficial WhatsApp integration terms/account risks separately; Google verification does not approve WhatsApp use.

The software adds validation and disclosure; it cannot establish external contracts, audit a provider, verify a domain or grant Google's approval.

## Official guidance reviewed

- [Google OAuth application verification help](https://support.google.com/cloud/answer/13464321) — successfully reviewed again on 16 November 2026; the complete English OAuth consent flow must appear in the demonstration.
- [Sensitive-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification) — public homepage/privacy, branding, verified domains, scope justification and demonstration requirements.
- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy) — Limited Use and permitted transfers/human access, including raw and derived data.
- [Calendar authorization scopes](https://developers.google.com/workspace/calendar/api/auth) — exact scope capabilities and narrower alternatives.

Official developer guidance was fetched successfully during preparation on 14 November 2026. Requirements and classifications can change; review the current console and official pages before submission.
