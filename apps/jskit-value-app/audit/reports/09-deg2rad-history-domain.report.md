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

## Fixed things

## Won't fix things
