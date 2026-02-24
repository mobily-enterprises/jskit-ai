# @jskit-ai/web-runtime-core

Shared frontend runtime helpers for list pagination state, query error messaging, URL-synced pagination, and API transport behavior.

## What this package is for

Use this package for reusable web runtime logic that is not UI-specific:

- pagination math helpers
- list pagination composables
- query state and query error message composables
- pagination synchronized with URL search params
- transport runtime around the HTTP client with command tracking and surface headers

This package keeps app views and stores small while preserving consistent request behavior.

## What this package is not for

- No Vue SFC UI components.
- No domain-specific API method wrappers (chat, billing, assistant, etc).
- No server-side route logic.

## Exports

- `@jskit-ai/web-runtime-core`
- `@jskit-ai/web-runtime-core/pagination`
- `@jskit-ai/web-runtime-core/useListPagination`
- `@jskit-ai/web-runtime-core/useListQueryState`
- `@jskit-ai/web-runtime-core/useUrlListPagination`
- `@jskit-ai/web-runtime-core/useQueryErrorMessage`
- `@jskit-ai/web-runtime-core/useGlobalNetworkActivity`
- `@jskit-ai/web-runtime-core/transportRuntime`

## Function reference

### `pagination`

- `normalizePage(value, fallback = 1)`
  - Normalizes to integer page >= 1.
  - Example: URL `page=-10` becomes page `1`.
- `normalizePageSize(value, fallback = 10)`
  - Normalizes to integer page size >= 1.
  - Example: invalid page size query value falls back to default.
- `getPreviousPage({ page, isLoading })`
  - Returns previous page safely, but does not move while loading.
  - Example: user clicks Previous during fetch; page is not changed twice.
- `getNextPage({ page, totalPages, isLoading })`
  - Returns next page within bounds, respecting loading state.
  - Example: on last page, Next keeps current page.
- `getFirstPage()`
  - Returns first page constant (`1`).
  - Example: after changing filters, list resets to page 1 explicitly.

### `useListPagination`

- `useListPagination({ initialPage, initialPageSize, defaultPageSize, getIsLoading, getTotalPages })`
  - Headless Vue composable returning:
    - `page`, `pageSize`
    - `resetToFirstPage()`
    - `goPrevious()`
    - `goNext()`
    - `onPageSizeChange(nextPageSize)`
  - Example: table component keeps pagination state and automatically resets to page 1 when page size changes.

### `useListQueryState`

- `useListQueryState(query, { resolveTotalPages })`
  - Derives `total`, `totalPages`, and `loading` from a query object.
  - Example: list page with TanStack query can bind these computed fields directly to pagination controls.

### `useQueryErrorMessage`

- `resolveErrorMessage(error, mapError)`
  - Builds user-facing message from optional mapper or error message.
  - Example: map 401 to `Please sign in again`, keep default for unknown failures.
- `useQueryErrorMessage({ query, handleUnauthorizedError, mapError })`
  - Watches query errors and returns reactive error message string ref.
  - Example: list view shows one clear banner message while central auth handler deals with unauthorized responses.

Related constant:

- `DEFAULT_ERROR_MESSAGE`

### `useGlobalNetworkActivity`

- `useGlobalNetworkActivity({ delayMs, minVisibleMs, includeRefetches })`
  - Derives global network activity state from Vue Query fetches and mutations.
  - Adds delay and minimum-visible smoothing to prevent UI flicker for short requests.
  - Returns `fetchingCount`, `mutatingCount`, `isBusy`, and `isVisible`.
  - Example: app shells render one top loading bar whenever route-level data is pending.

### `useUrlListPagination`

- `useUrlListPagination({ pageKey, pageSizeKey, initialPageSize, defaultPageSize, pageSizeOptions })`
  - Combines pagination state with URL search params via TanStack Router.
  - Keeps state in sync both directions:
    - URL change updates pagination refs
    - pagination change updates URL
  - Example: user shares URL with `?page=3&pageSize=50` and teammate opens exact same list view state.

### `transportRuntime`

- `createTransportRuntime({ createSurfacePaths, resolveSurfaceFromPathname, getClientId, commandTracker, aiStreamUrl, apiPathPrefix, realtimeCorrelatedWriteRoutes, generateCommandId })`
  - Creates transport object:
    - `request(url, options, state?)`
    - `requestStream(url, options, handlers, state?)`
    - `clearCsrfTokenCache()`
    - `__testables` helpers for tests
  - Responsibilities:
    - adds surface context headers for API requests
    - marks correlated write commands pending/acked/failed
    - supports ndjson stream detection fallback for AI stream endpoints
  - Example: when user updates a project, transport attaches command headers so realtime ack/fail events can match that specific write request.

Related constants:

- `DEFAULT_API_PATH_PREFIX`
- `DEFAULT_AI_STREAM_URL`
- `DEFAULT_REALTIME_CORRELATED_WRITE_ROUTES`

## How it is used in apps (real terms, and why)

Current `jskit-value-app` usage:

- direct composable usage in app views/modules:
  - `apps/jskit-value-app/src/views/projects/useProjectsList.js`
  - `apps/jskit-value-app/src/views/workspace-transcripts/useWorkspaceTranscriptsView.js`
  - `apps/jskit-value-app/src/views/console/useConsoleBrowserErrorsView.js`
- transport wiring:
  - `apps/jskit-value-app/src/platform/http/api/transport.js`
  - injects surface path resolver, client identity, and realtime command tracker

Why this matters:

- all list screens behave the same for page math and URL sync
- API transport behavior is consistent for csrf, headers, streaming, and command correlation
- frontend domain features can focus on business data, not repeated runtime plumbing

Practical list page flow:

1. User opens a list URL with pagination query params.
2. `useUrlListPagination` normalizes and applies them.
3. Query runs; `useListQueryState` provides `loading` and `totalPages`.
4. If query fails, `useQueryErrorMessage` provides a stable user message.
