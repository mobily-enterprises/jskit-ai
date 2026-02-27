# @jskit-ai/console-errors-fastify-routes

Fastify adapter for console error reporting and inspection endpoints.

## What this package is for

Use this package to expose endpoints that record browser errors and inspect browser/server error events in the workspace console.

## Key terms (plain language)

- `browser error`: error captured from frontend runtime (for example, uncaught JavaScript exception).
- `server error`: backend exception or structured error event.
- `console`: internal admin/operator UI for inspecting system state.

## Public API

## `createController(deps)`

Creates error-controller handlers.

Returned handlers:

- `listBrowserErrors`
  - Lists browser error events.
  - Real example: support engineer opens recent frontend errors for a workspace.
- `getBrowserError`
  - Returns one browser error by ID.
  - Real example: inspect stack trace for a specific client crash report.
- `listServerErrors`
  - Lists server error events.
  - Real example: operations team checks failures from the last hour.
- `getServerError`
  - Returns one server error event by ID.
  - Real example: drill into one incident for debugging.
- `recordBrowserError`
  - Ingests a browser error report.
  - Real example: frontend `window.onerror` reporter posts an event.
- `simulateServerError`
  - Triggers controlled test error flow.
  - Real example: verify alerting and logging pipeline in staging.

## `buildRoutes(controller, options)`

Returns Fastify route definitions for console error endpoints.

Real example: app registers routes under `/api/console/errors/...` and wiring stays consistent.

## `schema`

Exports request/response schemas for these routes.

Real example: malformed browser error payloads are rejected early.

## How apps use this package (and why)

Typical flow:

1. App creates console error service.
2. Adapter controller maps HTTP requests to service methods.
3. Routes are registered from `buildRoutes`.

Why apps use it:

- reusable incident/debug API surface
- consistent payload validation for frontend error ingestion
