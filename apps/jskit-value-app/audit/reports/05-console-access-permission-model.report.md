## Broken things

### [05-ISSUE-002] Console billing/transcript views bypass centralized unauthorized-session handling
- Severity: P2
- Confidence: high
- Contract area: security
- First seen: 2026-02-26
- Last seen: 2026-02-26
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/useConsoleAiTranscriptsView.js:1
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/useConsoleAiTranscriptsView.js:77
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/useConsoleAiTranscriptsView.js:100
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/ConsoleBillingEntitlementsView.vue:43
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/ConsoleBillingEntitlementsView.vue:56
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/ConsoleBillingPlanAssignmentsView.vue:45
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/ConsoleBillingPurchasesView.vue:45
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/ConsoleBillingSubscriptionsView.vue:43
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/useConsoleBillingEventsView.js:3
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/useConsoleBillingEventsView.js:78
- Why this is broken:
  - Several console views perform API calls and surface raw error strings without routing 401/403 through `handleUnauthorizedError`. Other console views already use `useAuthGuard` + `useQueryErrorMessage` for this. The inconsistency leaves session-expiry handling non-uniform and can keep stale authenticated UI state instead of fail-closed navigation/sign-out handling.
- Suggested fix:
  - Standardize console view data loaders on `useAuthGuard` + `useQueryErrorMessage` (or a shared wrapper composable) so all unauthorized responses follow one session-policy path.
- Suggested tests:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/views/useConsoleAiTranscriptsView.vitest.js
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/views/consoleBillingQueriesAuthHandling.vitest.js

### [05-ISSUE-003] Route-guard test suite misses AI transcript/member permission gate assertions
- Severity: P3
- Confidence: high
- Contract area: tests
- First seen: 2026-02-26
- Last seen: 2026-02-26
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/router/guards.console.js:197
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/router/guards.console.js:274
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/client/routerGuardsConsole.vitest.js:149
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/client/routerGuardsConsole.vitest.js:211
- Why this is broken:
  - Permission checks exist for `beforeLoadMembers` and `beforeLoadAiTranscripts`, but the route-guard test file does not assert deny/allow behavior for those two guards. This creates a regression gap in the console permission model.
- Suggested fix:
  - Extend `routerGuardsConsole.vitest.js` with explicit denied/allowed assertions for `beforeLoadMembers` (`console.members.view`) and `beforeLoadAiTranscripts` (`console.ai.transcripts.read_all`).
- Suggested tests:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/client/routerGuardsConsole.vitest.js

## Fixed things

### [05-ISSUE-001] Members invite/revoke actions do not fail closed on missing client permissions
- Fixed on: 2026-02-26
- How fixed:
  - Added explicit fail-closed checks in `submitInvite` and `submitRevokeInvite` so both mutations return immediately when the caller lacks `console.members.invite` or `console.invites.revoke`.
  - Added targeted composable tests that verify invite/revoke API mutations are not invoked when permissions are missing and still execute when permissions are granted.
- Validation:
  - `npm run test:client:views -- tests/views/useConsoleMembersView.vitest.js` (pass)
  - `npm run test:client:views -- tests/views/consoleMembersView.vitest.js` (pass)
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/useConsoleMembersView.js:182
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/useConsoleMembersView.js:205
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/views/useConsoleMembersView.vitest.js:188

## Won't fix things
