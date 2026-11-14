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

The page lists only this business's linked numbers, availability and appointment schedule. It does not expose conversations, customer message data, business rules, Calendar credentials, account management or dashboard access. Password changes and resets must be requested from the administrator.

## Sessions and deployment

The portal uses a separate, hashed server-side session with a seven-day HttpOnly cookie, not Supabase dashboard authentication. Admin resets, expiry and sign out invalidate sessions. Mutations require the configured web Origin and a custom request header. Login attempts are limited by IP and repeated failures lock the account temporarily. Login/session tables are server-only with RLS and no browser-role access.

Set `WEB_ORIGIN` to the deployed HTTPS web origin and `NEXT_PUBLIC_API_URL` to the API. Web/API hosts must be same-site (for example app.example.com and api.example.com) for SameSite=Lax session cookies, or reverse-proxy the API under the web origin. HTTPS enables Secure cookies. CORS permits credentials only for the configured web origin. Cookie authentication applies only to `/status-api`; it grants no access to Bearer-authenticated dashboard endpoints.
