# Production URLs and verification

Use [DEPLOYMENT.md](DEPLOYMENT.md) and [GOOGLE_VERIFICATION_CHECKLIST.md](GOOGLE_VERIFICATION_CHECKLIST.md) for the Ubuntu HTTPS rollout. Production callback: `https://api.netawaz.pk/calendar/oauth/callback`; public clinic login: `https://codetic.netawaz.pk/status`; admin: `/admin/login`. The private connection page now includes policy links and affirmative data-use consent recorded with the OAuth flow.

# Google Calendar setup

The integration is implemented locally. It cannot connect a real Google account until a public HTTPS API origin and Google OAuth credentials are configured. No clinic needs a dashboard account.

## One-time administrator setup

1. Deploy the API behind a stable public HTTPS address. Set `PUBLIC_API_URL` to that origin (no trailing path), for example `https://api.yourdomain.com`. Keep `WEB_ORIGIN` set to the actual dashboard origin. Configure your reverse proxy to forward `/calendar/*` to the API without logging query strings or invitation-token paths. Keep the server encryption key private and backed up.
2. In Google Cloud, create/select a project and enable Google Calendar API. Configure Google Auth Platform branding, audience, support email, application homepage, privacy policy and authorized domain. Use a separate development project for testing if possible.
3. Create an OAuth client of type **Web application**. Register exactly `https://api.yourdomain.com/calendar/oauth/callback` as an authorized redirect URI, replacing the example origin with your real `PUBLIC_API_URL`.
4. Configure the requested scopes: `openid`, `email`, `https://www.googleapis.com/auth/calendar.events`, `https://www.googleapis.com/auth/calendar.calendarlist.readonly`, and `https://www.googleapis.com/auth/calendar.events.freebusy`. These let the clinic choose a writable calendar, check availability and create events. The grant is broader than the selected calendar; the application itself restricts use to the calendar selected for that business.
5. Set server-only `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the deployment secret store or ignored root `.env`. Do not put them in `NEXT_PUBLIC_*`, source control or the browser. Restart the API. `SESSION_ENCRYPTION_KEY` must remain the same across restarts to decrypt stored credentials.
6. During Google testing, add the clinic account as a test user. Google may require app verification before general public use. External apps in testing can receive refresh tokens with a seven-day lifetime for these scopes; production approval is needed for a dependable public rollout. See Google's current OAuth documentation.

Local development can use an explicitly configured `http://localhost:3101` origin and `CALENDAR_ALLOW_LOCAL_OAUTH=true`, with the matching localhost redirect registered in Google. Such a link is only usable on the same machine; it is not a public clinic onboarding link. Keep this flag false for deployment.

## Clinic onboarding

- Select the business, then **Connections → Google Calendar → Create connection link**.
- Share the link privately with the clinic owner. It expires after 24 hours and works once. Creating another link revokes earlier unused links for that business.
- The owner sees the business name and a Calendar approval explanation, clicks Continue with Google, signs in to Google and approves all requested permissions. A browser-bound state and PKCE verifier protect the callback.
- The primary writable calendar is connected by default. The owner sees Calendar connected and can close the page. No workspace membership is created.
- Your dashboard updates through the existing workspace event stream. You may select a different writable calendar.
- The clinic signs in to `/status` → Appointments, reviews bookable weekdays, time zone, start/finish times and appointment length, enables automatic booking, and saves. The administrator creates the portal login under Connections → Clinic portal. Booking stays off until you explicitly enable it. The example/default hours are not inferred from clinic facts.

## Customer booking flow

The assistant collects a specific date and time in the configured calendar timezone, checks availability, and proposes an exact slot. The customer must reply `CONFIRM <six-character code>` within 30 minutes. The assistant rechecks tenant, conversation mode, opt-out, AI status, current calendar, booking hours, internal overlap reservations and Google free/busy before creating an event.

Google events contain a generic Appointment title and private application request identifiers. Customer medical details and WhatsApp identities are not copied into Calendar. This first version creates Calendar appointments; it does not send guest email invitations, create Meet links, or automatically reschedule/cancel existing events. Staff handle changes to booked appointments.

Event IDs are deterministic, and duplicate confirmations do not create another event. If a Google write times out, the application looks up that ID. An unverifiable result is shown as uncertain and is not blindly retried. Staff must check Google before making a replacement booking. Creating/uncertain records reserve the local slot until reviewed. External Calendar edits can still race a free/busy check: Google does not provide an atomic free/busy-and-insert operation.

Disconnect removes our stored credentials and disables assistant scheduling. Existing Google events remain. The Google account holder can revoke the application's grant from Google Account → third-party connections as well.

## Verification and rollout

Automated tests use mocked Google endpoints and an embedded PostgreSQL database. Real consent, refresh, public callback reachability and phone-to-calendar creation remain unverified until administrator setup and a real approval are completed. Use a dedicated test calendar for the first live booking.

References: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [Free/busy](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query), [Create an event](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert).

## Calendar public-link routing

The web server now forwards `/calendar/*` to the API, including the approval page, form submission and OAuth callback. If `PUBLIC_API_URL` points to the web origin (such as `http://localhost:3000` in development), keep the callback registered at that same origin plus `/calendar/oauth/callback`. Set server-only `API_INTERNAL_URL` in `apps/web/.env.local` when the API upstream is not `http://127.0.0.1:3101`. This upstream must identify the API process, not the web server itself. Restart/redeploy the web server after changing it.
