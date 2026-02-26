## Broken things

- None.

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

### [05-ISSUE-002] Console billing/transcript views bypass centralized unauthorized-session handling
- Fixed on: 2026-02-26
- How fixed:
  - Added `useAuthGuard` handling to `useConsoleAiTranscriptsView` and fail-closed unauthorized checks in all transcript API error branches (`loadConversations`, `selectConversation`, `exportSelection`).
  - Extracted console billing read views into dedicated composables so each query now routes through `useQueryErrorMessage` with `handleUnauthorizedError`.
  - Updated billing SFCs to consume those composables while keeping template behavior stable.
- Validation:
  - `npm run test:client:views -- tests/views/useConsoleAiTranscriptsView.vitest.js` (pass)
  - `npm run test:client:views -- tests/views/consoleBillingQueriesAuthHandling.vitest.js` (pass)
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/useConsoleAiTranscriptsView.js:37
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/useConsoleAiTranscriptsView.js:80
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/useConsoleAiTranscriptsView.js:106
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/useConsoleAiTranscriptsView.js:139
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/useConsoleBillingEntitlementsView.js:7
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/useConsoleBillingPlanAssignmentsView.js:15
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/useConsoleBillingPurchasesView.js:32
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/useConsoleBillingSubscriptionsView.js:15
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/ConsoleBillingEntitlementsView.vue:42
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/ConsoleBillingPlanAssignmentsView.vue:44
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/ConsoleBillingPurchasesView.vue:44
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/ConsoleBillingSubscriptionsView.vue:42
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/views/useConsoleAiTranscriptsView.vitest.js:86
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/views/consoleBillingQueriesAuthHandling.vitest.js:71

### [05-ISSUE-003] Route-guard test suite misses AI transcript/member permission gate assertions
- Fixed on: 2026-02-26
- How fixed:
  - Extended console route-guard tests with explicit deny/allow assertions for:
    - `beforeLoadMembers` (`console.members.view`)
    - `beforeLoadAiTranscripts` (`console.ai.transcripts.read_all`)
  - This locks regression coverage for both permission gates in the router guard contract.
- Code changes were applied in:
  - `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/client/routerGuardsConsole.vitest.js`
- Validation:
  - `npm run test -- tests/client/routerGuardsConsole.vitest.js` (pass)
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/router/guards.console.js:197
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/router/guards.console.js:274
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/client/routerGuardsConsole.vitest.js:149
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/client/routerGuardsConsole.vitest.js:162
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/client/routerGuardsConsole.vitest.js:180
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/client/routerGuardsConsole.vitest.js:196

## Won't fix things
