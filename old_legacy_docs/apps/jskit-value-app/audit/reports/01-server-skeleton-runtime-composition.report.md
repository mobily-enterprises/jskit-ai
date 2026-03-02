## Broken things

## Fixed things

### [01-ISSUE-001] Raw-body plugins double-decorate `request.rawBody` and crash bootstrap
- Fixed on: 2026-02-26
- Applied solution:
  - Updated both raw-body plugins to guard request decoration with `fastify.hasRequestDecorator("rawBody")` so `decorateRequest("rawBody", null)` executes only once per Fastify instance.
  - Kept both plugin `preParsing` hooks intact so each endpoint family still captures raw payloads without decorator collisions.
  - Added `tests/rawBodyPluginsRegistration.test.js` to register both plugins together and assert bootstrap-safe decorator state.
- Validation:
  - `npm run test -- tests/rawBodyPluginsRegistration.test.js tests/serverBootstrapBuildServer.test.js tests/actionIdempotencyAdapters.test.js tests/actionRegistry.test.js tests/billingRuntimeBootstrap.test.js` (pass: 12, fail: 0)
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/fastify/billingWebhookRawBody.plugin.js:20
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/fastify/activityPubRawBody.plugin.js:22
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/rawBodyPluginsRegistration.test.js:8

### [01-ISSUE-002] Billing action idempotency adapter ignores billing idempotency service
- Fixed on: 2026-02-26
- Applied solution:
  - Removed the implicit billing-service injection surface from `createActionIdempotencyAdapter` and made the adapter explicitly noop-only.
  - Removed the unused billing idempotency argument from action registry composition so runtime wiring matches actual behavior.
  - Added `tests/actionIdempotencyAdapters.test.js` to lock in noop claim/replay/mark semantics for action runtime idempotency.
- Validation:
  - `npm run test -- tests/rawBodyPluginsRegistration.test.js tests/serverBootstrapBuildServer.test.js tests/actionIdempotencyAdapters.test.js tests/actionRegistry.test.js tests/billingRuntimeBootstrap.test.js` (pass: 12, fail: 0)
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/idempotencyAdapters.js:3
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/createActionRegistry.js:10
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/actionIdempotencyAdapters.test.js:6

### [01-ISSUE-003] Bootstrap smoke tests do not execute `buildServer`, missing real plugin registration failures
- Fixed on: 2026-02-26
- Applied solution:
  - Added `tests/serverBootstrapBuildServer.test.js` with a worker harness that imports `server.js`, executes `buildServer({ frontendBuildAvailable: false })`, and closes the app.
  - This test now exercises real Fastify plugin/decorator registration during bootstrap instead of import-only checks.
- Validation:
  - `npm run test -- tests/rawBodyPluginsRegistration.test.js tests/serverBootstrapBuildServer.test.js tests/actionIdempotencyAdapters.test.js tests/actionRegistry.test.js tests/billingRuntimeBootstrap.test.js` (pass: 12, fail: 0)
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/serverBootstrapBuildServer.test.js:19
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/serverBootstrapBuildServer.test.js:55

## Won't fix things
