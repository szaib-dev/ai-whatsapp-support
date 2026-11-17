# Agent configuration and conversation reliability

## Root causes and changes

- The old language resolver gave written static language directives precedence over a clear incoming language. Current messages now take precedence; ambiguous reactions use recent customer language rather than copying an earlier assistant mistake.
- The old template path contained the exact generic unknown-message response reported for emojis. That fallback and the unused localized/handover template helpers were removed. The live path uses validated structured actions. IGNORE exits before booking processing and never becomes a missing-answer retry.
- Provider failures, malformed results and repeated legacy output fail to silence plus owner review, without a canned customer reply. A structured handover retains its configured acknowledgement.
- Conversation history now follows only reliable same-account phone/LID aliases. The database rows remain intact. External-AI provenance filtering still excludes Calendar-derived output, staff text, legacy generated text and private confirmation codes.
- The latest prior main deployment failed at npm ci because native optional dependencies were missing from the lockfile. The lockfile was regenerated with npm 10, matching CI, and a Linux x64 clean-install dry run passed.

## Storage and permissions

Six Markdown documents live in per-workspace database rows: IDENTITY.md, SOUL.md, OWNER.md, RULES.md, KNOWLEDGE.md and MEMORY.md. A backward-compatible migration copies the published legacy configuration without deleting prior revisions. Existing instructions and tone go to SOUL; escalation/restrictions to RULES; descriptions and approved answers to KNOWLEDGE. OWNER and global MEMORY start without invented details. Unpublished legacy revisions remain retained in the original tables.

Document saves use optimistic version checks and immutable version history. Restoring a prior version/default creates a new version. Owner-authorized API routes enforce workspace membership. Client portal credentials have no agent or diagnostic endpoints. Essential documents remain enabled; optional documents and per-document retrieval ceilings are configurable. Saving a document changes a configuration revision, invalidating already generated replies that used an older revision.

## Context and playground

Security and operational rules have priority over editable documents. Essential identity/personality/rules are bounded; optional excerpts use lexical relevance against the current turn and recent customer turns. This is lexical retrieval, not a vector database, and may omit semantically related passages without matching terms. Recent conversation and customer memory have separate bounded fields. Input/output limits are configurable; UTF-8 token counts in the editor/context builder are conservative estimates, while provider usage is reported separately.

The administrator playground uses processAssistantTurn and the same DeepSeek/context/parser path as live WhatsApp. It has no live account/contact record, notification/delivery capabilities or appointment adapter. Handover is simulated in test state. Reset clears local test history. Playground content is sent to the configured provider and is not persisted as customer history.

Optional AI_INPUT_USD_PER_MILLION and AI_OUTPUT_USD_PER_MILLION rates produce an estimated USD cost from actual usage. Empty rates show cost unavailable; no pricing is invented. No paid dependencies were introduced.

## Verification

The embedded PostgreSQL/API suite covers isolation, migration, immutable history, conflicts, restore, privacy, cancellation of stale generations, silent actions and playground side-effect suppression. Existing appointment, WhatsApp, handover, push and Calendar regressions remain in the suite.

`npm run build:api` then `node scripts/evaluate-agent.mjs` runs only synthetic messages against the configured provider. Twelve cases passed: introduction, multi-turn bakery recall, standalone emojis, goodbye, Roman Urdu, switching to English, Punjabi, complaint/sarcasm, urgent owner request and direct AI disclosure. Model output is probabilistic; this does not prove universal language understanding.

Browser review used the actual component with temporary in-memory sample data. Autosave, Markdown preview, history, restore confirmation, context limits, mobile selection and silent playground diagnostics were exercised. Responsive checks at 320/360/390/430/768/1024/1440/1920 px found no page-level horizontal overflow. Temporary QA routes are removed before release. Real WhatsApp sends and real notification/Google operations are not triggered by this evaluation.

Final local checks: 244 tests passed and one existing test skipped; TypeScript, ESLint, production build, deployment-script regression scenarios, dependency audit and Linux npm 10 clean-install dry run passed. The provider evaluation passed all 12 synthetic cases. Production deployment is monitored separately after the commit is pushed.


## Rolling takeover reliability follow-up

The installed Baileys `messages-recv.js` emits offline messages with `append` and live messages with `notify`; a notify-only owner guard missed linked-device/offline outgoing traffic. Both now reach the same persisted deduplication and monotonic timestamp handling. Protocol sync traffic, missing/invalid/future timestamps and reserved AI/dashboard transport IDs do not count as native manual replies. Customer history remains excluded from live intake.

Every new genuine owner timestamp extends the contact's deadline by 30 minutes, propagating through verified account-scoped phone/LID aliases. Explicit indefinite takeover stays indefinite, including dashboard sends. Old offline history cannot cancel fresh intake after its historical deadline or invalidate an otherwise eligible fresh generation. Inbox alias groups show the latest temporary deadline and retain indefinite status when applicable. Timer diagnostics contain event types/counts/deadlines, never message bodies, names or phone numbers.

A live synthetic Punjabi evaluation exposed another parser root cause: a valid reply was rejected because its provider explanation exceeded the 240-character metadata limit. Explanations are now bounded independently; action consistency and customer reply validation remain strict. Parsing failures expose only issue codes/field paths in diagnostics.

Controlled clock regressions cover the 0/14/43-minute reset sequence (29 minutes after the previous reply), duplicate and older events, mapped aliases, a new worker reading persisted state, automatic expiry, delayed paused intake and permanent handover. Existing tests also cover in-progress generation cancellation, per-contact independence, outbound ID persistence and workspace isolation. Transport tests exercise both notify/append events, protocol and AI echoes, and invalid timestamps. These are synthetic socket events; physical phone/linked-device delivery still requires a real device exchange and must not be claimed as verified solely from these tests.


Explicit resume also retains an intake watermark: messages timestamped before the resume remain suppressed even if device delivery occurs later. Automatic timer expiry retains the historical deadline, so fresh post-expiry input remains eligible. Follow-up validation: 252 tests passed, one existing test skipped; TypeScript, ESLint, API build and full production build passed. The real-provider 12-case synthetic evaluation passed after the metadata fix. Deployment status and physical-device verification are reported separately.
