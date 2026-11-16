# Appointment management and shared design system

The public website, legal/support pages, authentication, administrator workspace and `/status` client portal share the Manrope typography, neutral surfaces, orange accents, Lucide icons and responsive component styles. Controlled select menus use Radix. Shared tooltips and loading skeletons provide keyboard descriptions and loading feedback. Existing authentication, WhatsApp sessions, reply policies, knowledge publication and OAuth routes are retained.

## Enable the feature

Select a business in the administrator workspace, open **Settings → Workspace features**, and enable **Advanced appointment management**. Only that business's owner can change its permissions. There is no checkout or subscription. The portal notices changes within five seconds; basic schedule settings and appointment viewing remain available when advanced management is locked.

Permissions live in `workspace_features`, keyed by organization and feature key, with RLS enabled and browser-role access revoked. Both reads of advanced appointment details and every mutation require a valid, enabled portal session and the persisted feature permission. Mutations also enforce the existing origin/header CSRF policy. Locked previews contain only a static, anonymous calendar grid, with a contact action through the existing support page.

## Manage appointments

In **Client portal → Appointments**, use list/calendar views, search and status filters, create a booking or blocked time, edit/reschedule, or cancel with confirmation. The editor interprets times in the configured business timezone, independently of the browser timezone. Nonexistent daylight-saving times are rejected. Working hours, appointment duration and the existing automatic-booking switch retain their original behavior.

The advanced list includes up to 2,000 requests starting in the previous 365 days and all upcoming requests within that result limit. Basic viewing prioritizes future appointment requests and excludes blocked time. Basic responses never include private names, titles or notes.

## Calendar consistency and recovery

- Manual bookings use the existing `appointment_requests` table and Google authorization. Existing rows, event IDs, credentials and OAuth scopes are retained.
- Creating and rescheduling lock the same calendar row used by the WhatsApp confirmation flow, validate business hours, and reject overlaps with booked, creating or uncertain requests, including blocked time.
- A durable reservation is committed before Google I/O. Google events are checked for conflicting opaque events, excluding the current booking. Event list pagination is followed. Google Calendar does not provide an atomic check-and-insert operation against edits made by external calendar clients.
- The existing deterministic event ID and a per-workspace request key prevent duplicate creation. A lost response leaves an uncertain reservation with a **Retry sync** action. Recovery looks up and verifies the event before updating it; it does not blindly create another event. Private customer names and notes stay in the application database; event titles and times synchronize.
- Cancellation deletes the Google event and retains a cancelled database record. Missing/already-deleted Google events are handled idempotently. In-flight WhatsApp confirmations cannot be cancelled from the portal until they finish. Uncertain requests remain reserved until their sync is resolved or cancellation is confirmed.
- The Google helpers accept an optional transaction client so sync operations do not acquire a second database-pool connection while holding calendar locks.

## Deployment

`202611160002_advanced_appointments.sql` is additive. It adds the feature table and appointment metadata/idempotency/recovery columns, and permits manual requests without a WhatsApp contact or conversation. Existing booking rows keep their status and relationships. The migration has an exact checksum entry in the existing reviewed migration policy; the current deployment process applies it before the new API starts. Do not remove the new columns on application rollback: old application versions can continue to use the expanded schema.

No local or production database was migrated during implementation. Production environment values, payment systems and deployment topology were not changed.

## Validation

- Final test result: 210 passed, one opt-in live database test skipped.
- Automated PostgreSQL-backed API tests cover owner-only grants, tenant isolation, backend locking, revocation, browser-role denial, CSRF, invalid/out-of-hours bookings, create/edit/reschedule/cancel, blocked-slot conflicts, request idempotency, provider failure and recovery after a lost Google response.
- Existing WhatsApp, privacy, AI, authentication and Calendar regression suites remain in the test run. The opt-in live database lock test is skipped unless its documented environment variables are provided.
- Browser review used an isolated local fixture for authenticated UI states. The fixture was removed before building. All eight workspace sections and four portal sections passed overflow checks at 360, 390, 768, 1024 and 1920 pixels; public and authentication pages were also reviewed across those breakpoints. Dialogs, calendar/list switching, searching, editing, cancellation and locked/unlocked previews were exercised. Google responses were mocked in integration tests; no live Google event or customer booking was created.
- `npm run build`, `npm run typecheck`, `npm run lint`, and the full test suite are the release checks. The separate `check:production` command reports existing development-environment omissions (operator/contact details, public HTTPS origins and operator/provider approval flags); it needs the actual production environment to pass.
