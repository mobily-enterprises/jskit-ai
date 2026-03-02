# @jskit-ai/observability-core

Shared observability primitives plus console error-domain services.

## Exports

- `@jskit-ai/observability-core`
- `@jskit-ai/observability-core/client/consoleErrorsApi`
- `@jskit-ai/observability-core/services/consoleErrors`
- `@jskit-ai/observability-core/browserPayload`
- `@jskit-ai/observability-core/serverPayload`
- `@jskit-ai/observability-core/metricsContracts`
- `@jskit-ai/observability-core/metricsRegistry`
- `@jskit-ai/observability-core/scopeLogger`
- `@jskit-ai/observability-core/service`

## Ownership boundaries

- Owns console error-domain API wrapper (`consoleErrorsApi`) and service (`consoleErrors.service`).
- Owns browser/server error payload normalization helpers.
- Owns metrics registry + scoped observability service primitives.
- Does not register HTTP routes or perform direct SQL; repositories are injected.

## Primary APIs

### `createConsoleErrorsService(deps)` (`services/consoleErrors`)

Creates service methods for:

- listing browser/server errors
- fetching single browser/server errors
- recording browser errors
- simulating server errors

### `createConsoleErrorsApi(httpClient)` (`client/consoleErrorsApi`)

Client API wrapper for `/api/v1/console/errors/*` and `/api/v1/console/simulate/server-error` endpoints.

### `createBrowserErrorPayloadTools(...)` (`browserPayload`)

Normalizes browser `error` and `unhandledrejection` events into transport-safe payloads.

### `createConsoleErrorPayloadNormalizer(...)` (`serverPayload`)

Normalizes server/browser error payloads for ingestion and storage contracts.

### `createMetricsRegistry(...)` and `createService(...)`

Provides Prometheus metric contracts, guardrail metrics, and scoped logger helpers used by runtime composition.
