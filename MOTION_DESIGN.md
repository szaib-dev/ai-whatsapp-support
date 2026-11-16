# Codetic product interface — 17 November 2026

The public site uses editorial typography, asymmetric sections and abstract supporting graphics. The former dashboard illustration, floating UI cards and tilted feature mockups have been removed, together with their unused components and stylesheets.

The authenticated application uses real shadcn/ui components generated into `apps/web/components/ui`, Radix accessibility primitives, Lucide icons, and shared tokens in `app/globals.css`. `app/product.css` owns functional product layouts; `(public)/editorial.css` owns public layouts. The shared `FormDialog`, `ConfirmDialog`, `DateTimeField` and `TimeSelect` compose those primitives.

## Motion

`app/ui/motion.tsx` configures Motion and provides page/tab entrances, reveal transitions and toast feedback. Radix data-state animations cover dialogs, popovers, menus, sheets and accordions. Buttons use 180ms background, border, shadow and press transitions; icon arrows move subtly on hover. Component transitions use 200–350ms, selected entrances use 500ms. Reduced-motion preferences disable nonessential movement. There is no global DOM animation observer.

## Product navigation

The admin workspace uses a collapsible shadcn Sidebar, a full-height mobile Sheet, workspace combobox, searchable command menu, notification indicator and direct account/sign-out controls. Inbox selection opens a dedicated phone conversation view. Owner replies show a pause deadline and restart a rolling 30-minute quiet window; explicit takeover/resume controls remain available. The composer responds to visualViewport resizing; a physical mobile keyboard still requires device testing.

The standalone client portal has a compact header and Home / Appointments / Connections / More bottom navigation. Backend permissions deny conversation and VIP endpoints to portal sessions. Portal attention responses and pushes never contain messages, sender names, private reasons, conversation IDs or inbox links. Generic notification history is available in Notifications. Online/offline remains a manual assistant control and is never changed by login/logout.

Appointments share server conflict checking and Google synchronization between owner administration and premium client access. Date selection uses Calendar/Popover; time and duration use custom Select controls. The mobile editor fills the viewport. Privacy confirmations use centered AlertDialogs, retain list position and update a contact after the server confirms the stop. Locked appointment previews render abstract geometry, never private records underneath blur.

## Verification

The rendered public landing page, admin settings and client privacy layout were screenshot-reviewed at 320, 360, 390, 430, 768, 1024, 1440 and 1920 px, with no page-level horizontal overflow. Additional desktop/mobile review covered the inbox, appointment editor, custom calendar/time menu, premium lock, knowledge editor, connections, authentication, mobile Sheet and account menus. Functional UI checks used the actual components in isolated sample workspaces; those temporary routes were removed before the production build.

Observed interactions include command search/navigation, sidebar collapse, mobile destination dismissal, conversation resume, appointment creation/editing, client sign-out, and stopping a scrolled privacy contact without changing scroll position. Tests cover server authorization, premium access, alias grouping, handover/replay, booking conflicts and notification privacy. UI fixtures do not establish successful real Google or WhatsApp operations.

Physical keyboard behavior, a fresh successful credential login, real WhatsApp pairing, real Google synchronization and background OS push receipt were not verified during this redesign. Deployment still requires genuine operator/contact information, public HTTPS origins and legal/provider/backup review; configuration checks must not be bypassed.

## Final release checks

- 233 automated tests passed; one existing test skipped (16 files passed, one skipped).
- TypeScript checks, ESLint, production build and diff whitespace checks passed.
- Production dependency audit reported zero vulnerabilities.
- Both additive migrations applied successfully to the local configured database.
- The final build was reviewed on port 3000; the API health endpoint on 3101 returned `ok`.
- The local WhatsApp worker still reported recovery during initialization. Pairing credentials were preserved; another worker's database lease was not forcefully terminated.
- The production configuration check continues to require operator identity/country, support/privacy contacts, backup retention, HTTPS web/API origins, disabling local OAuth and operator legal/provider confirmations. These are deployment prerequisites, not fabricated values.
