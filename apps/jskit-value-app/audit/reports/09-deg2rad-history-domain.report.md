## Broken things

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
