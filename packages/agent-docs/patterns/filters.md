# Structured Filters

Use when:
- a CRUD list needs flags, enums, date ranges, record-id filters, or lookup-backed filters
- the user asks to "add a filter", "make the list filterable", or "keep filters in the URL"
- a screen mixes free-text search with structured facets

Server-side note:
- for the current CRUD server contract on the JSON REST path, see `server-search.md`
- this file is about the shared structured-filter runtime used by CRUD list pages and explicit list-filter modules

Ask first:
- which fields are filterable
- whether each filter is a flag, enum, multi-enum, date/date-range, number-range, record id, or lookup-backed record id
- whether filters must sync to the route query
- whether the screen needs chips and clear/reset behavior
- whether lookup filters need remote autocomplete search
- whether there are presets such as "Today", "Last 7 Days", or "Only Archived"

Default JSKIT client pattern:
1. Generated CRUD list pages include a page-local `listFilters.js` file next to `index.vue`.
2. Put client filter definitions in that file with `defineCrudListFilters(...)`.
3. The generated `index.vue` passes `listFilters` into `useCrudListScreen(...)`; the shared list screen builds `useCrudListFilters(listFilters)`, passes `filterRuntime.queryParams` into the list request, and renders `CrudListFilterSurface`.
4. If `listFilters` is empty, the filter surface renders nothing and the page behaves like a normal searchable list.
5. The AI/app author is responsible for ensuring the server accepts and applies the query params declared in `listFilters.js`.
6. For lookup-backed filters, use `useCrudListFilterLookups(...)` when the page needs remote options or readable chip labels.

Generated client shape:
- `src/pages/<surface>/<resource>/listFilters.js`
- `const listFilters = defineCrudListFilters({ ... })`
- `useCrudListScreen({ ..., listFilters })`
- shared screen runtime owns:
- `const filterRuntime = useCrudListFilters(listFilters)`
- `queryParams: filterRuntime.queryParams`
- `<CrudListFilterSurface :filters="listFilters" :runtime="filterRuntime" />`

Server-side pattern, only when implementing real backend filter semantics:
1. Put reusable filter definitions in the CRUD package if server code or multiple pages need the same contract.
   Example path: `packages/<crud>/src/shared/<crud>ListFilters.js`
2. Build a server contract from that module with `createCrudListFilterContract(...)`.
3. Use the contract's `queryValidator` in route/action input composition.
4. Pass the contract's `jsonRestSearchSchema` into `createJsonRestResourceScopeOptions(..., { searchSchema })`.
5. Call `contract.toJsonRestQuery(query)` before `buildJsonRestQueryParams(...)` in the JSON REST repository path.

Exact file checklist:
- create `packages/<crud>/src/shared/<crud>ListFilters.js`
- create `packages/<crud>/src/server/<crud>ListFilterContract.js` with `createCrudListFilterContract(...)`
- update `packages/<crud>/src/server/registerRoutes.js` and `packages/<crud>/src/server/actions.js` so the list query validator includes `listFilterContract.queryValidator`
- update the provider's `createJsonRestResourceScopeOptions(...)` call so `searchSchema: listFilterContract.jsonRestSearchSchema` is merged into the internal JSON REST resource
- update `packages/<crud>/src/server/repository.js` so list queries pass `listFilterContract.toJsonRestQuery(query)` into `buildJsonRestQueryParams(...)`
- update the generated page-local `listFilters.js` first; only edit `index.vue` if a specialist lookup label/runtime integration is needed
- for lookup-backed filters, wire `useCrudListFilterLookups(...)` beside the existing generated filter runtime instead of replacing `CrudListFilterSurface`

Validation mode is part of the contract:
- `createCrudListFilterContract(...)` defaults to `invalidValues: "reject"` for a strict server boundary
- set `invalidValues` explicitly when a package is choosing a non-default validation posture
- use `invalidValues: "reject"` when malformed filter values should fail validation and return a 400-style contract error
- use `invalidValues: "discard"` when malformed filter values should be ignored and normalization should drop them
- route query validation runs before auth, so this choice affects whether malformed unauthenticated requests fail at validation or fall through to auth
- for normal HTTP CRUD handlers, route-level `discard` means the action layer receives already-parsed values for those explicit filter fields; do not assume route `discard` plus action `reject` will still reject malformed HTTP query strings later
- CRUD list filters are still a deliberate two-phase exception: schema parsing owns public query-field values, then the server contract reprojects parsed values to JSON REST filters with `toJsonRestQuery(...)`

Keep separate:
- free-text search uses `records.searchQuery` and `q`
- structured filters use explicit query params through `useCrudListFilters(...)`

Use `useCrudListFilterLookups(...)` when:
- a filter is `recordId` or `recordIdMany`
- the UI needs remote autocomplete search
- chips should show readable labels instead of raw ids

Use built-in `presence` when:
- a filter means null vs not-null, such as assigned vs unassigned storage
- the UI wants custom labels like "Assigned" / "Unassigned" but the transport contract can stay `present` / `missing`
- you do **not** need custom SQL beyond `whereNotNull(...)` / `whereNull(...)`

Use runtime presets when:
- the page has quick filters such as "Today", "Last 7 Days", or "Only Archived"
- the preset should reuse the same filter state/reset/query-param runtime as the rest of the page
- relative-date presets need dynamic `resolveValues()` instead of hard-coded dates
- the active-state UI should reflect the full current filter state through `matchesPreset(...)`, including extra route-hydrated values that still appear as chips

Put unusual SQL semantics on the server:
- examples: `pending` meaning `whereNull("ccp1_passed")`, or business-specific status buckets that combine multiple columns
- implement those in `createCrudListFilterContract(..., { apply: { ... } })`
- do not use custom `apply` just for null/not-null checks when `type: "presence"` fits

Avoid:
- local filter composables that duplicate the same keys the server already knows about
- a custom validator shape that does not match the page state
- hand-rolled route/action validators or repository filters that duplicate `createCrudListFilterContract(...)`
- hand-rolled preset apply/reset/active-state helpers when `useCrudListFilters(..., { presets })`, `applyPreset(...)`, and `matchesPreset(...)` fit
- per-screen `useList()` wrappers for lookup-backed filters when `useCrudListFilterLookups(...)` fits
- editing generated `.vue` files just to add basic filter controls; use the page-local `listFilters.js` seam first
- overloading `q` with structured filter meaning
- inline filter-definition objects passed into `useCrudListFilters(...)`, `createCrudListFilters(...)`, or `createCrudListFilterContract(...)`; keep definitions in a named module

Good shape:
- `src/pages/home/customers/listFilters.js`
- `const listFilters = defineCrudListFilters({ status: { type: "enum", ... } })`
- generated page passes `listFilters` into `useCrudListScreen(...)`
- shared screen runtime passes `filterRuntime.queryParams` into the list request
- `packages/receivals/src/shared/receivalListFilters.js`
- `createCrudListFilterContract(RECEIVAL_LIST_FILTER_DEFINITIONS, { columns, invalidValues: "reject" })`
- `createJsonRestResourceScopeOptions(resource, { searchSchema: receivalListFilterContract.jsonRestSearchSchema })`
- `buildJsonRestQueryParams(JSON_REST_SCOPE_NAME, receivalListFilterContract.toJsonRestQuery(query))`
- `const listFilters = useCrudListFilters(RECEIVAL_LIST_FILTER_DEFINITIONS, { presets: [...] })`
- `const filterLookups = useCrudListFilterLookups(RECEIVAL_LIST_FILTER_DEFINITIONS, { values: listFilters.values, ... })`
- `queryParams: listFilters.queryParams`

Preset contract notes:
- `resolveValues({ values, filters, presetKey, preset })` receives the current filter state and the normalized preset metadata, so relative-date presets can derive values at apply time without page-local helper state
- `matchesPreset(...)` compares against the full current filter state after basic normalization; it does **not** silently drop extra `enumMany` or `recordIdMany` values that were hydrated from the route and still show up as active chips
- if the URL contains `status=archived&status=bogus`, a preset for only `archived` should not render as active while the `bogus` chip is still visible

Review checks:
- one filter definition source of truth: generated page-local `listFilters.js` for client-only filters, or a shared CRUD-package module when server code imports the same definitions
- server validator, JSON REST search schema, and repository query projection derived from that source through `createCrudListFilterContract(...)`
- client query params/chips/reset logic derived from that source
- lookup-backed filters use the shared lookup helper, not a page-local mini-framework
- the two-phase server exception is intentional and documented, not accidental drift
