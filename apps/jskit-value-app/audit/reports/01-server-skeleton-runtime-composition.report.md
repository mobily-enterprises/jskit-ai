## Broken things

## Fixed things

### [ISSUE-001] Raw-body plugins double-decorate `request.rawBody` and crash bootstrap
- Fixed on: 2026-02-26
- How fixed:
  - Replaced request-decoration guards in both raw-body plugins with `fastify.hasRequestDecorator("rawBody")` before `decorateRequest("rawBody", null)`.
  - Added a regression test that registers both plugins on one Fastify instance and asserts decorator availability.
- Validation:
  - `npm run test -- tests/rawBodyPluginsRegistration.test.js tests/serverBootstrapBuildServer.test.js tests/actionIdempotencyAdapters.test.js tests/actionRegistry.test.js tests/billingRuntimeBootstrap.test.js` (pass: 12, fail: 0)
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/fastify/billingWebhookRawBody.plugin.js:20
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/fastify/activityPubRawBody.plugin.js:22
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/rawBodyPluginsRegistration.test.js:8

### [ISSUE-002] Billing action idempotency adapter ignores billing idempotency service
- Fixed on: 2026-02-26
- How fixed:
  - Removed the misleading adapter branch that accepted a billing idempotency service but still executed noop behavior.
  - Made action-runtime idempotency adapter explicitly noop-only and documented billing idempotency ownership in billing-service methods.
  - Updated action-registry composition to stop passing unused billing idempotency dependencies and added a contract test for noop behavior.
- Validation:
  - `npm run test -- tests/rawBodyPluginsRegistration.test.js tests/serverBootstrapBuildServer.test.js tests/actionIdempotencyAdapters.test.js tests/actionRegistry.test.js tests/billingRuntimeBootstrap.test.js` (pass: 12, fail: 0)
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/idempotencyAdapters.js:3
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/createActionRegistry.js:10
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/actionIdempotencyAdapters.test.js:6

### [ISSUE-003] Bootstrap smoke tests do not execute `buildServer`, missing real plugin registration failures
- Fixed on: 2026-02-26
- How fixed:
  - Added a worker-based bootstrap smoke test that imports `server.js`, executes `buildServer({ frontendBuildAvailable: false })`, and closes the app to exercise real Fastify registration paths.
- Validation:
  - `npm run test -- tests/rawBodyPluginsRegistration.test.js tests/serverBootstrapBuildServer.test.js tests/actionIdempotencyAdapters.test.js tests/actionRegistry.test.js tests/billingRuntimeBootstrap.test.js` (pass: 12, fail: 0)
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/serverBootstrapBuildServer.test.js:19
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/serverBootstrapBuildServer.test.js:55

## Won't fix things
