## Broken things

## Fixed things

### [ISSUE-002] `shared/apiPaths` helper contract has no direct behavior tests
- Fixed on: 2026-02-26
- How fixed:
  - Added a dedicated `tests/apiPaths.test.js` suite that verifies normalization and behavior for `toVersionedApiPath`, `toVersionedApiPrefix`, `buildVersionedApiPath`, `isVersionedApiPrefixMatch`, `isVersionedApiPath`, and `isApiPath`.
- Validation:
  - `npm test -- tests/apiPaths.test.js tests/consoleRoutePolicyDefaults.test.js tests/apiRoutesRegistration.test.js tests/adminRoutePermissionPolicy.test.js tests/readmeApiContracts.test.js` (pass)
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/apiPaths.test.js:15
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/apiPaths.test.js:25
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/apiPaths.test.js:33
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/apiPaths.test.js:44

### [ISSUE-001] Console route default policy matcher is prefix-boundary unsafe
- Fixed on: 2026-02-26
- How fixed:
  - Updated console policy defaulting to a version-aware, segment-boundary-safe check (`/api/v1/console` exact or nested path), preventing false matches like `/api/consolex/*`.
  - Added a regression test that injects a synthetic `/api/consolex/*` route and verifies no console defaults are applied.
- Validation:
  - `npm test -- tests/apiPaths.test.js tests/consoleRoutePolicyDefaults.test.js tests/apiRoutesRegistration.test.js tests/adminRoutePermissionPolicy.test.js tests/readmeApiContracts.test.js` (pass)
  - `npm run docs:api-contracts:check` (pass)
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/api/routes.js:109
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/api/routes.js:111
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/consoleRoutePolicyDefaults.test.js:54
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/consoleRoutePolicyDefaults.test.js:70

## Won't fix things
