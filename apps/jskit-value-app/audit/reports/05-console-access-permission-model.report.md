## Broken things

### [ISSUE-001] Members invite/revoke actions do not fail closed on missing client permissions
- Severity: P2
- Confidence: high
- Contract area: policy
- First seen: 2026-02-26
- Last seen: 2026-02-26
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/useConsoleMembersView.js:50
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/useConsoleMembersView.js:51
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/useConsoleMembersView.js:53
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/useConsoleMembersView.js:182
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/useConsoleMembersView.js:201
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/useConsoleMembersView.js:218
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/router/guards.console.js:215
- Why this is broken:
  - The view computes `canInviteMembers` and `canRevokeInvites`, but `submitInvite` and `submitRevokeInvite` execute mutations without checking those permissions. `submitMemberRoleUpdate` already enforces `canManageMembers`, so mutation-level fail-closed handling is inconsistent. If UI wiring regresses (or actions are invoked programmatically), view-only members can still trigger privileged API mutation attempts.
- Suggested fix:
  - Add early permission guards in `submitInvite` and `submitRevokeInvite` (matching the existing `submitMemberRoleUpdate` pattern), and return before mutation when permission is missing.
- Suggested tests:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/views/useConsoleMembersView.vitest.js

### [ISSUE-002] Console billing/transcript views bypass centralized unauthorized-session handling
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

### [ISSUE-003] Route-guard test suite misses AI transcript/member permission gate assertions
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

## Won't fix things
