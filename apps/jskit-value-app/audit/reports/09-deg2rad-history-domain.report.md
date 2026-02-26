## Broken things

### [09-ISSUE-004] `history.service.listForUser` trusts raw user/pagination input and can violate API contract
- Status: OPEN
- Severity: P1
- Confidence: high
- Contract area: api
- First seen: 2026-02-26
- Last seen: 2026-02-26
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/history/service.js:62
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/history/service.js:64
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/history/service.js:67
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/history/service.js:70
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/history/repository.js:83
- Why this is broken:
  - The service uses `user.id`, `user.displayName`, `pagination.page`, and `pagination.pageSize` without normalization. Runtime validation shows null users throw raw `TypeError`, and negative/NaN pagination can propagate invalid `page`/`totalPages` and negative offsets to repository reads. This bypasses the structured `AppError` contract and creates fail-open behavior for non-route callers (`assistant_tool`/`internal`) that do not benefit from route query validation.
- Suggested fix:
  - Add service-level guards that normalize/authenticate user identity and clamp pagination (`page >= 1`, `1 <= pageSize <= 100`) before repository access; throw structured `AppError` (`401`/`400`) when inputs are invalid.
- Suggested tests:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/historyService.test.js
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/realtimeActionContributorPublish.test.js
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/actionRegistry.test.js
- Related:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/06-action-runtime-composition.report.md [06-ISSUE-001]

### [09-ISSUE-005] DEG2RAD/history UI flow lacks direct component/view regression coverage
- Status: OPEN
- Severity: P2
- Confidence: high
- Contract area: tests
- First seen: 2026-02-26
- Last seen: 2026-02-26
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/e2e/auth-history.spec.js:16
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/e2e/auth-history.spec.js:147
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/historyRouteSchema.test.js:157
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/client/api.vitest.js:422
- Why this is broken:
  - Current tests cover route/query schema and low-level API client behavior, but there is no direct test coverage for `Deg2radCalculatorForm`, `Deg2radHistoryList`, or `Deg2radCalculatorView` wiring (refresh token propagation, pagination controls, and UI error rendering). Regressions in these required-scope client modules can ship without failing CI.
- Suggested fix:
  - Add focused client tests for the view + two components with mocked API/auth guard behavior, including successful calculation refresh, history pagination interactions, and error/unauthorized handling branches.
- Suggested tests:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/views/deg2radCalculatorView.vitest.js
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/components/deg2radCalculatorForm.vitest.js
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/components/deg2radHistoryList.vitest.js

## Fixed things

### [09-ISSUE-001] `deg2rad.calculate` assistant-tool input schema is incompatible with service validation
- Fixed on: 2026-02-26
- How fixed:
  - Replaced assistant tool schema input contract to canonical DEG2RAD fields only (`DEG2RAD_operation`, `DEG2RAD_degrees`) with strict schema keys and no legacy `degrees` compatibility.
  - Added action-registry assertions to fail if the assistant schema regresses back to legacy `degrees` input.
- Validation:
  - `npm run test -- tests/realtimeActionContributorPublish.test.js` (pass)
  - `npm run test -- tests/actionRegistry.test.js` (pass)
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/deg2radHistory.contributor.js:80
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/actionRegistry.test.js:1128

### [09-ISSUE-002] Realtime publish path drops UUID `historyId` metadata for DEG2RAD writes
- Fixed on: 2026-02-26
- How fixed:
  - Removed numeric coercion of `historyId` in realtime publish payload construction.
  - Added explicit history-id normalization to preserve non-empty UUID strings and publish them as-is for `entityId` and `payload.historyId`.
- Validation:
  - `npm run test -- tests/realtimeActionContributorPublish.test.js` (pass)
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/deg2radHistory.contributor.js:69
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/deg2radHistory.contributor.js:195
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/deg2radHistory.contributor.js:203

### [09-ISSUE-003] Domain realtime test fixtures mask production DEG2RAD/history contracts
- Fixed on: 2026-02-26
- How fixed:
  - Updated realtime contributor test fixture to use canonical DEG2RAD request/result shapes (`DEG2RAD_*`) instead of custom `{ degrees }` and numeric result fields.
  - Updated fixture history ids to UUID strings and asserted realtime `entityId` + `payload.historyId` preserve UUID values.
- Validation:
  - `npm run test -- tests/realtimeActionContributorPublish.test.js` (pass)
  - `npm run test -- tests/actionRegistry.test.js` (pass)
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/realtimeActionContributorPublish.test.js:120
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/realtimeActionContributorPublish.test.js:153
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/realtimeActionContributorPublish.test.js:205

## Won't fix things
