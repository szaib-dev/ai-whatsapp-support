# Codetic interface and motion refinements

The landing page uses a layered product window, a warm ambient light field and a responsive bento composition. The previews illustrate the inbox, Google Calendar scheduling, staff handover and separate business workspaces. They contain anonymous sample UI, are labelled as illustrative, and do not fetch customer data or invent business statistics. Existing integration and privacy disclosures remain visible. The former dark marketing section is replaced with a light setup flow.

The dashboard overview now shows actual workspace connection, knowledge-publication and reply-enabled state instead of a promotional welcome panel. Existing API requests, feature permissions, authentication, WhatsApp and Calendar behavior are unchanged.

## Shared motion

`app/ui/motion.tsx` provides the Motion configuration and reusable components. `app/motion-system.css` provides matching CSS transitions.

| Interaction | Duration | Behavior |
| --- | --- | --- |
| Hover, press, switches | 150–200 ms | Small transform, color and shadow changes |
| Menus and component state | 200–350 ms | Short opacity/position transitions |
| Native dialog close | 160 ms | Close only after the exit finishes; preserve native focus restoration |
| Section entrance | 500 ms | One-time viewport-triggered fade and 18 px rise |
| Updated statistics | 400 ms | Animate between actual values; no fabricated initial count-up |

The shared easing is `cubic-bezier(.22, 1, .36, 1)`. Main motion uses transforms and opacity. FAQ expansion and supported native details use intrinsic height to keep surrounding content in normal document flow. Product previews float gently; ambient gradients move slowly. Both stop with reduced-motion preferences.

- `MotionView` enters a newly selected page or tab immediately. It does not keep previous workspace data mounted for an exit animation. Its key must match the actual navigation state, rather than polling data.
- `MotionNotice` animates feedback entry and dismissal. `DrawerBackdrop` handles mobile sidebar backdrop presence.
- `useDialogMotion` / `closeDialogElement` retain native modal semantics. Cancel, Escape, close buttons and successful appointment saves share the closing transition. Busy protections remain in the existing handlers.
- Calendar month transitions affect the grid, keeping navigation buttons mounted so keyboard focus stays on the selected month-navigation control.
- Radix select menus retain their existing keyboard/typeahead behavior and animate using their open/closed data attributes. Mobile public navigation supports Escape, focus restoration, outside-click dismissal and closing after a destination is selected.
- The interface observer animates newly inserted loading results and feedback without replacing application state or timers. It disconnects on cleanup and skips Motion-managed notices.
- `MotionConfig`, `useReducedMotion` and the CSS `prefers-reduced-motion` rules respect the system preference. Native details retain their normal behavior when intrinsic-size animation is unsupported.

## Visual and interaction review

Browser review used actual rendered application components with an isolated local fixture for authenticated states. No customer records or external Google/WhatsApp operations were changed. The fixture is removed before the production build.

Reviewed the landing page and all eight administrator and four client-portal sections at 360, 390, 768, 1024 and 1920 px. The checks included horizontal overflow and clipped landing-page headings, screenshots at desktop/mobile sizes, navigation, FAQ expansion/collapse, native dialog opening/closing, appointment creation/editing, toast feedback, select menus, month navigation and premium locking/unlocking. Calendar navigation retained keyboard focus. The locked state had no rendered appointment editor. Public legal/support pages and sign-in layouts were also checked after the shared-style changes.

Run the existing test suite, production build, typecheck, lint and dependency audit before release. Browser testing validates UI behavior; the existing backend regression tests continue to validate authorization and booking consistency.

## Final verification — 16 November 2026

- Production build, TypeScript checks and ESLint passed.
- Regression suite: 210 tests passed; one test skipped (14 files passed, one skipped).
- Production dependency audit: zero vulnerabilities. `git diff --check` passed.
- Rechecked the production landing page in the browser at desktop and 390/360 px mobile widths. Reviewed hero and workflow previews, FAQ expansion/collapse, mobile navigation and Escape dismissal. No horizontal page overflow was observed. Also reviewed mobile administrator/client sign-in and privacy layouts; the final landing page had no captured console warnings or errors.
- Authenticated interactions were covered by the earlier isolated-fixture review described above. They were not repeated against a live backend during this final pass because the local API was offline; the client login correctly showed its service-unavailable feedback.
- Deployment remains blocked by production configuration validation: operator identity/country, support/privacy contacts, backup retention description, public HTTPS web/API origins, disabling local Calendar OAuth, and operator confirmation of legal disclosures/provider data terms. These require real deployment values and review; they were not fabricated or bypassed.
