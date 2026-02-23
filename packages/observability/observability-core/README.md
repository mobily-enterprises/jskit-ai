# @jskit-ai/observability-core

Shared observability payload helpers for browser error reporting, server-side error payload normalization, and metrics label contracts.

## What this package is for

Use this package to standardize observability data before it is stored or exported:

- build browser error payloads from `window.error` and `unhandledrejection`
- normalize console error payloads on server ingestion
- provide common metrics content type and label normalization helpers

This keeps error and metrics data consistent across modules.

## What this package is not for

- No database writes.
- No HTTP controllers.
- No metrics registry implementation.
- No alerting logic.

## Exports

- `@jskit-ai/observability-core`
- `@jskit-ai/observability-core/browserPayload`
- `@jskit-ai/observability-core/serverPayload`
- `@jskit-ai/observability-core/metricsContracts`

## Function and constant reference

### `browserPayload`

Entry point:

- `createBrowserErrorPayloadTools({ resolveSurfaceFromPathname })`
  - Returns utility methods for browser error event payloads.
  - Example: app bootstrapping code creates one toolset and reuses it for both `error` and `unhandledrejection` listeners.

Returned methods:

- `stringifyReason(value)`
  - Converts rejection reason to readable string.
  - Example: promise rejects with object; this turns it into JSON-like text for logs.
- `toStack(value)`
  - Extracts stack string from `Error` or stack-like object.
  - Example: keeps stack traces when available for debugging.
- `buildBasePayload(source)`
  - Builds shared payload fields (`occurredAt`, `url`, `path`, `surface`, `userAgent`).
  - Example: every browser error report includes route and surface info.
- `createPayloadFromErrorEvent(event)`
  - Creates normalized payload from `window` error event.
  - Example: captures filename/line/column when script error occurs.
- `createPayloadFromRejectionEvent(event)`
  - Creates normalized payload from unhandled rejection event.
  - Example: captures rejection reason type and stack for async failures.

### `serverPayload`

Entry point:

- `createConsoleErrorPayloadNormalizer({ parsePositiveInteger })`
  - Returns payload normalization methods for server-side error ingestion.
  - Example: console error service creates one normalizer instance and uses it before every repository write.

Returned methods:

- `normalizeString(value, maxLength = 0)`
  - Trims and length-limits strings.
  - Example: keeps giant exception messages from exploding storage.
- `normalizeStack(value, maxLength = 16000)`
  - Bounds stack trace size.
  - Example: preserves useful stack while preventing oversized rows.
- `normalizeObject(value)`
  - Produces safe bounded metadata object.
  - Example: large nested metadata becomes compact structured fields.
- `normalizeIsoDate(value)`
  - Converts date-like input to ISO string or `null`.
  - Example: invalid client date does not break ingestion.
- `normalizeBrowserPayload(payload, user)`
  - Normalizes browser error payload plus user metadata.
  - Example: browser report endpoint turns raw payload into DB-safe shape.
- `normalizeServerPayload(payload)`
  - Normalizes server error payload shape.
  - Example: middleware error capture writes stable schema rows.
- `normalizeSimulationKind(value)`
  - Validates simulation kind or rotates through defaults for `auto`.
  - Example: console error simulation endpoint cycles through failure modes.
- `createSimulationId()`
  - Creates unique simulation marker id.
  - Example: correlate simulated error logs with a single trigger action.

Related constant:

- `SERVER_SIMULATION_KINDS` (`app_error`, `type_error`, `range_error`, `async_rejection`)

### `metricsContracts`

- `normalizeMetricLabel(value, { fallback = "unknown", maxLength = 64 })`
  - Lowercases and sanitizes metric label values to safe characters.
  - Example: route label `/Workspace/Acme` becomes stable safe metric label.

Related constants:

- `PROMETHEUS_CONTENT_TYPE`
- `DEFAULT_HTTP_DURATION_BUCKETS_SECONDS`

## How it is used in apps (real terms, and why)

Current `jskit-value-app` usage:

- browser capture:
  - `apps/jskit-value-app/src/services/browserErrorReporter.js`
  - uses `createBrowserErrorPayloadTools` to build payloads for browser error reporting endpoint
- console error service normalization:
  - `apps/jskit-value-app/server/domain/console/services/errors.service.js`
  - uses `createConsoleErrorPayloadNormalizer` for browser and server payload ingestion, and simulation helpers

Why this matters:

- ingestion endpoints receive predictable payload shape
- dashboards and debugging tools can trust field formats
- malformed or oversized metadata is sanitized before storage

Practical ingestion flow:

1. Browser runtime captures `window.error`.
2. `createPayloadFromErrorEvent` builds payload with route and stack details.
3. API receives payload.
4. `normalizeBrowserPayload` sanitizes and bounds fields before repository insert.

Note on metrics contracts:

- `metricsContracts` exports are available for shared metrics implementations.
- In current app state, some metrics plumbing still exists in app-local modules; this package provides shared contracts for migration and reuse.
