## Broken things

### [09-ISSUE-001] `deg2rad.calculate` assistant-tool input schema is incompatible with service validation
- Status: OPEN
- Severity: P1
- Confidence: high
- Contract area: action-runtime
- First seen: 2026-02-26
- Last seen: 2026-02-26
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/deg2radHistory.contributor.js:75
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/deg2radHistory.contributor.js:149
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/deg2rad/service.js:18
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/deg2rad/service.js:27
- Why this is broken:
  - The assistant tool schema requires `{ "degrees": ... }`, but execution passes that object directly into `validateAndNormalizeInput`, which requires `DEG2RAD_operation` and `DEG2RAD_degrees`. In runtime validation, executing `deg2rad.calculate` with `{ degrees: 180 }` returns HTTP 400 validation errors instead of performing conversion.
- Suggested fix:
  - Normalize assistant/internal input before service validation (map `degrees -> DEG2RAD_degrees` and set `DEG2RAD_operation="DEG2RAD"`), or move to one shared canonical input schema used by both API and assistant-tool channels.
- Suggested tests:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/realtimeActionContributorPublish.test.js
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/actionRegistry.test.js
- Related:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/07-action-catalog-governance-drift.report.md [07-ISSUE-003]

### [09-ISSUE-002] Realtime publish path drops UUID `historyId` metadata for DEG2RAD writes
- Status: OPEN
- Severity: P2
- Confidence: high
- Contract area: realtime
- First seen: 2026-02-26
- Last seen: 2026-02-26
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/history/service.js:28
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/deg2radHistory.contributor.js:192
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/deg2radHistory.contributor.js:197
- Why this is broken:
  - History IDs are UUID strings, but realtime publish logic coerces them through `Number(...)`. UUIDs become `NaN`, so published events use `entityId: "none"` and `payload.historyId: null`, removing correlation data for consumers/diagnostics.
- Suggested fix:
  - Treat `historyId` as a string identifier in realtime payload/entity mapping (non-empty UUID string check), and avoid numeric coercion.
- Suggested tests:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/realtimeActionContributorPublish.test.js
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/realtimeRoutes.test.js
- Related:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/07-action-catalog-governance-drift.report.md [07-ISSUE-003]

## Fixed things

## Won't fix things
