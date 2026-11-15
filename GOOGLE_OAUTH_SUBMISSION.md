# Codetic AI — Google OAuth submission packet

Prepared 16 November 2026 against the current official Google pages linked below. **Not Google approved.** This is a targeted verification-readiness review of the existing live product, not a repeat infrastructure audit.

## Submission blockers and verified boundaries

- Public HTTPS probes from this review environment returned **HTTP 403, Cloudflare error 1010** for the homepage, Privacy, Terms, Support, Data Deletion and API callback. The edge TLS handshake completed with certificate validation, but app content/callback could not be independently inspected through that edge block. Earlier successful CI health checks from the VPS are not evidence that Google reviewers/crawlers can reach these URLs. Resolve the edge restriction before requesting brand verification.
- The connection disclosure previously said booking results remain backend-only. That was inaccurate: proposed/confirmed times are sent to the requesting customer through WhatsApp. The code now explicitly discloses WhatsApp/Meta processing and authorized clinic-team/portal access, retains the exclusion from AI prompts, and records disclosure version **2026-11-16**. The Privacy Policy matches this behavior. No OAuth scope or booking behavior is changed by this correction.
- Source review confirms server-side authorization-code exchange, state, browser-binding HttpOnly/Secure cookie, PKCE S256, ten-minute single-use flow, 24-hour single-use clinic invite, verified Google ID-token audience/email, required Calendar-scope checks and organization-bound AES-GCM refresh-token storage. Public connection links do not grant dashboard membership.
- Existing provenance filtering excludes Calendar output/booking confirmation state from general AI context. Appointment extraction's current-message path now uses that same filtering. Actual outgoing-payload tests cover quoted/forwarded results, quoted lines, short protected results and confirmation codes across extraction and general DeepSeek entry points. No claim of a complete independent provider/contracts audit is made.
- Google Cloud project identity, DNS/Search Console ownership, live consent-screen settings and actual user consent/booking cannot be verified without the operator's authenticated Console/test flow. Do not mark those completed from source inspection.

## Exact Google Cloud fields

Use the **existing production project and Web application OAuth client** already deployed, not a new client. Keep its secret server-only; do not paste secrets into the submission or recording.

| Console field | Value |
| --- | --- |
| App name | Codetic AI |
| Audience | External, for clinics using Google accounts outside one Workspace organization |
| User support email | szaib.dev@gmail.com (must be selectable/controlled by the project operator) |
| Developer contact email | szaib.dev@gmail.com |
| Legal operator, if requested | Shahzaib Mirza (operating under the brand Codetic), individual, Pakistan |
| App homepage | https://codetic.netawaz.pk/ |
| Privacy policy | https://codetic.netawaz.pk/privacy |
| Terms of service | https://codetic.netawaz.pk/terms |
| Support | https://codetic.netawaz.pk/support |
| Deletion instructions | https://codetic.netawaz.pk/data-deletion |
| Authorized domain | netawaz.pk; verify its ownership in Search Console using an Owner/Editor account on this Google Cloud project |
| OAuth client type | Web application |
| Authorized redirect URI | https://api.netawaz.pk/calendar/oauth/callback |
| Authorized JavaScript origins | Not required by this server-side redirect flow; if retained, use exact production origins https://codetic.netawaz.pk and https://api.netawaz.pk |
| API to enable | Google Calendar API |
| Publishing | Production for the public release; publish verified Branding before requesting Data Access verification using the Console's current sequence |
| Reviewer admin entry | https://codetic.netawaz.pk/admin/login |
| Clinic portal | https://codetic.netawaz.pk/status |

Do not register a connection-link token, a state value, a clinic ID, wildcards or localhost as the production callback. Localhost may remain in a separate development client/project if needed. A bare callback request should reach the application and return its controlled **400** authorization-error page; it should not redirect to login, return 404 or be blocked by Cloudflare. Do not invent an authorization code/state for a live test.

### Copy-paste application description

> Codetic AI helps clinic teams handle WhatsApp customer support and explicitly confirmed appointment scheduling. A clinic administrator generates a private expiring link so its Google account owner can authorize Calendar access without receiving dashboard access. An authorized clinic team member selects an existing writable calendar, including a shared calendar, and configures booking hours. The backend checks a requested interval, proposes a time to the requesting customer through WhatsApp, and creates one Calendar event only after that customer sends the confirmation code. The app retrieves its own event by a deterministic ID only to reconcile an uncertain create result. It does not offer general event browsing, calendar deletion or ACL management.

## Exact scope entries and justifications

Declare **exactly** the following runtime scope set on Data Access. The Console determines its current sensitive/non-sensitive classification; do not add broader Calendar/Drive/Gmail scopes or claim a restricted-scope security assessment is required without the Console requesting one.

### openid

> We verify the ID token's issuer/audience and Google account subject after the authorization-code exchange to bind the Calendar connection to the account that approved the clinic's private invitation. Google authorization does not create an admin/dashboard account.

### email

> We require a verified email from that Google identity and display/store it for the clinic's authorized administrator to identify the connected account. We do not request profile photos, a contacts list, Gmail or additional profile access. Google may display this basic scope as https://www.googleapis.com/auth/userinfo.email; it corresponds to the runtime email scope.

### https://www.googleapis.com/auth/calendar.calendarlist.readonly

> We call CalendarList.list (GET /calendar/v3/users/me/calendarList with minAccessRole=writer) to identify the primary writable calendar and populate the existing calendar-selection control for authorized clinic administrators. Clinics can choose an already-existing owned or shared writable calendar. No calendar-list entries are added or modified. Event/free-busy scopes do not replace permission to enumerate the account's calendar list; app-created-calendar or owned-only access would not support this existing shared-calendar selection feature.

### https://www.googleapis.com/auth/calendar.events.freebusy

> We call POST /calendar/v3/freeBusy only for the clinic-selected calendar and the customer's requested appointment interval, before proposing and again before confirming a slot. We need only busy intervals, not unrelated event titles, descriptions or attendee details. This scope avoids requesting full read-only Calendar access for availability. The Calendar events scope is not one of the authorizations documented for freeBusy.query, so this separate permission is necessary.

### https://www.googleapis.com/auth/calendar.events

> We call Events.insert to create an explicitly confirmed appointment on the clinic-selected existing writable calendar, and Events.get using that appointment's application-generated deterministic event ID to reconcile an uncertain insertion and avoid duplicates. Clinics already use shared calendars on which the authorizing account is a writer but not the owner. calendar.events.owned would exclude those calendars; calendar.app.created would require a different product restricted to new app-created calendars. Read-only and free/busy scopes cannot insert events. No narrower create-only scope supports these existing owned-and-shared calendar operations. Although this grant permits broader event access, the implemented app does not list/read unrelated events, edit/delete them or manage calendar ACLs.

## Data-handling answer for reviewers

> Calendar authorization is optional and requested only when the Google account owner opens a clinic's private invitation. Before Google consent, a mandatory disclosure identifies access by the authorized clinic team and the delivery of proposed/confirmed booking times to the requesting customer through WhatsApp/Meta. Calendar access is restricted by the app to the selected calendar. Google refresh tokens are encrypted with organization-bound AES-256-GCM; temporary access tokens remain in backend memory. Calendar identifiers, timezone, connection identity and appointment status/times are stored in our configured PostgreSQL database. Google credentials are never browser build arguments or AI inputs. Calendar data and Calendar-derived booking replies/confirmation state are excluded from external AI requests. DeepSeek processes independently authored customer text and approved non-Calendar business context; this is disclosed separately. Appointment events use a generic Appointment title and internal identifiers, without WhatsApp conversation bodies or patient medical details. No Google API data is used for advertising, sale, credit decisions or generalized AI-model training. Human access is limited to the consented clinic feature and permitted support/security/legal purposes. Disconnect removes our stored connection/refresh token and access-token cache; existing Google events and historical appointment records remain. The account holder can separately revoke the Google grant and request deletion through the public deletion page/email. Retention and operator-assisted deletion are disclosed accurately; we do not claim automatic full-account deletion or a fixed deletion SLA.

Confirm actual operator/provider practices match this statement before attesting to it. The existing production release flags are not independent proof of contracts or practices. Do not upload patient data, Google tokens, passwords or production admin credentials to the verification form/video.

## Short demonstration video script (about 3–4 minutes)

Record the **live HTTPS deployment**, a dedicated synthetic clinic and an empty test calendar. Use the production OAuth client under review. Set the Google consent screen language to **English**. Upload to YouTube as **Unlisted**, with no viewer login/permission request. Keep the OAuth client ID visible as Google requests; hide codes, state tokens, invite capabilities, passwords and patient data. Never show the client secret.

| Time | Screen/action and suggested narration |
| --- | --- |
| 0:00–0:25 | Public homepage, footer Privacy/Terms, then Privacy sections 4–5. “This is Codetic AI, clinic WhatsApp support and confirmed appointment scheduling. Calendar authorization is optional. This policy explains the Google permissions, clinic-team access, WhatsApp booking messages, AI exclusions, storage and deletion.” |
| 0:25–1:10 | Sign into a dedicated reviewer/test workspace off-camera, open Connections → Google Calendar, create/open a test private link in a separate signed-out profile. Show the disclosure and select its checkbox. “The Google account owner can approve without dashboard membership.” Continue to Google; show the complete English consent screen, Codetic AI name, production OAuth client ID in the address bar and every requested permission. Approve with the test account. |
| 1:10–1:40 | Return to connection success and admin Calendar settings; show the connected test email and writable owned/shared calendar choices. Select the dedicated test calendar, hours and enable booking. “OpenID/email identify the approving account. Calendar-list read-only access populates these existing writable calendars, including shared calendars.” |
| 1:40–2:40 | From a synthetic WhatsApp customer, request a specific future time inside booking hours. Show the proposal and no event yet. Send CONFIRM with its code, then show exactly one Appointment event at that time in Google Calendar. Repeat the confirmation and show no duplicate. “Free/busy checks the interval without fetching unrelated event contents. Events access creates the confirmed appointment and retrieves only that deterministic event after an uncertain insert.” Show a busy-slot rejection briefly if available. |
| 2:40–3:20 | Show Privacy/Data Deletion and disconnect this test connection in the app. “Google Calendar data and booking results are excluded from AI prompts. The requested appointment's times are delivered through WhatsApp with consent. Disconnect removes stored credentials, but previously created events remain.” Show Google Account → third-party connections as the separate grant-revocation option. |

Do not spend the recording on unrelated WhatsApp QR setup, AI tone controls or a full product tour. The required evidence is the end-to-end OAuth grant and the functionality using every requested scope.

### Reviewer access instructions

> Open https://codetic.netawaz.pk/. For the full demonstration use the dedicated synthetic reviewer workspace supplied privately in this submission at /admin/login, then Connections → Google Calendar. Generate a fresh 24-hour invitation and open it in a separate browser profile to authorize your permitted test Google account. The invitation creates no dashboard membership. Select an existing writable test calendar, enable booking hours, and use the synthetic WhatsApp test channel shown in the video to request/confirm an appointment. Do not use production patient data. A /status clinic login alone cannot generate OAuth invitations or open owner-only Calendar settings.

Provide a **dedicated restricted synthetic workspace** and test access privately only if requested. Reviewer credentials are intentionally not generated/stored in this repository. Do not reuse your production administrator password or put a short-lived invite URL in place of durable reviewer instructions. If an OAuth project remains in Testing while a reviewer tests, make the required designated test account eligible before the test.

## Cloudflare blocker: exact narrow exception to review

Observed: all six production probes above returned 403/error 1010 rather than application content on 16 November 2026. Error 1010 is associated with Cloudflare Browser Integrity Check. In Cloudflare for the **netawaz.pk zone**, create an early custom Skip rule for **Browser Integrity Check only** on the public verification/OAuth paths below, or use the equivalent scoped Configuration Rule. Keep TLS, DDoS protections, authentication, OAuth state/PKCE and unrelated services unchanged. Do not disable the entire WAF or add an unrestricted origin bypass.

~~~text
(http.host eq "codetic.netawaz.pk"
 and http.request.method in {"GET" "HEAD"}
 and http.request.uri.path in {"/" "/privacy" "/terms" "/support" "/data-deletion"})
or
(http.host eq "api.netawaz.pk"
 and (
  (http.request.uri.path eq "/calendar/oauth/callback"
   and http.request.method in {"GET" "HEAD"})
  or
  (starts_with(http.request.uri.path, "/calendar/connect/")
   and http.request.method in {"GET" "POST"})
 ))
~~~

If Cloudflare's UI exposes the setting through Configuration Rules rather than Skip products on your plan, apply Browser Integrity Check Off to the same expression. Inspect Security Events for any additional rule causing a challenge; change only the confirmed blocking rule. The private connection endpoints still enforce expiring invitation capability, affirmative consent and callback state/PKCE in the app. Ensure required static assets and the reviewer sign-in flow are reachable in an ordinary signed-out browser too; do not blindly exempt authenticated APIs. Retest from outside the VPS: public pages must return 200 and readable content; bare callback must reach the controlled 400 page. This zone change cannot be made using the repository/deployment SSH key and has not been claimed complete.

## Only manual submission steps remaining

1. Resolve/retest the Cloudflare public-access blocker, then verify netawaz.pk in Search Console with the project's Owner/Editor account.
2. In the existing Google Cloud project, enable Calendar API, confirm the exact production callback, fill Branding/contacts/URLs above, and declare exactly the five scopes. Verify and publish Branding, then follow the Console's production audience/Data Access verification flow.
3. Perform one real test-account consent → calendar selection → proposed slot → explicit confirmation → single event → disconnect/revocation flow. Record/upload the short unlisted English-consent video using the script.
4. Confirm the disclosed data-use, retention/deletion and provider practices; paste these scope justifications/video URL and requested private test-access instructions into Verification Center, submit, and monitor szaib.dev@gmail.com for reviewer follow-up.

## Official sources checked

- [Google sensitive-scope verification and current Branding/Data Access submission sequence](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [Google verification requirements, including the complete English OAuth screen/video](https://support.google.com/cloud/answer/13464321)
- [Google API Services User Data Policy and Limited Use](https://developers.google.com/terms/api-services-user-data-policy)
- [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth)
- [Freebusy.query accepted authorizations](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query)
- [Events.insert accepted authorizations](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
- [Cloudflare error 1010 reference](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1010/)
- [Cloudflare Browser Integrity Check and scoped controls](https://developers.cloudflare.com/waf/tools/browser-integrity-check/)

Google pages were fetched during this review. Cloudflare documentation could not be retrieved by the web tool in this environment; confirm the current Console placement of the narrowly scoped control. Public accessibility, domain ownership and final verification are not established by a code commit or a healthy VPS alone.
