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
- whether a filter needs a default before the first request
- whether the screen needs chips and clear/reset behavior
- whether lookup filters need remote autocomplete search
- whether there are presets such as "Today", "Last 7 Days", or "Only Archived"

Default JSKIT client pattern:
1. CRUD list pages use a page-local `listFilters.js` file next to `index.vue`.
2. Put client filter definitions in that file with `defineCrudListFilters(...)`.
3. The app-owned `index.vue` passes `listFilters` into `useCrudListScreen(...)`; the shared list screen builds `useCrudListFilters(listFilters)`, passes `filterRuntime.queryParams` into the list request, and renders `CrudListFilterSurface`.
4. If `listFilters` is empty, the filter surface renders nothing and the page behaves like a normal searchable list.
5. The AI/app author is responsible for ensuring the server accepts and applies the query params declared in `listFilters.js`.
6. For lookup-backed filters, use `useCrudListFilterLookups(...)` when the page needs remote options or readable chip labels.

Initial-value contract:
- declare a pre-query default with `defaultValue` in the filter definition
- a valid route-query value wins over `defaultValue`
- when the initial route has no value, `defaultValue` is applied before list reading is enabled
- an invalid initial route value falls back to `defaultValue`
- clearing a filter after initialization produces the empty value; it does not reapply the default
- route back/forward navigation rehydrates the same filter state without an early unfiltered request

```js
const listFilters = defineCrudListFilters({
  currentness: {
    type: "enum",
    defaultValue: "active",
    options: [
      { value: "active", label: "Active" },
      { value: "archived", label: "Archived" }
    ]
  }
});
```

Client shape:
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
3. Pass the contract's `queryValidator` through the dedicated
   `listFilterQueryValidator` option of the standard CRUD list validator group
   at both the route and action boundaries.
4. Pass the contract's `jsonRestSearchSchema` into `createJsonRestResourceScopeOptions(..., { searchSchema })`.
5. Call `contract.toJsonRestQuery(query)` before `buildJsonRestQueryParams(...)` in the JSON REST repository path.

Exact file checklist:
- create `packages/<crud>/src/shared/<crud>ListFilters.js`
- create `packages/<crud>/src/server/<crud>ListFilterContract.js` with `createCrudListFilterContract(...)`
- update `packages/<crud>/src/server/registerRoutes.js` so
  `createCrudJsonApiRouteContracts(...)` receives
  `listFilterQueryValidator: listFilterContract.queryValidator`
- update `packages/<crud>/src/server/actions.js` so
  `createStandardCrudListQueryValidators(...)` receives the same
  `listFilterQueryValidator`
- update the provider's `createJsonRestResourceScopeOptions(...)` call so `searchSchema: listFilterContract.jsonRestSearchSchema` is merged into the internal JSON REST resource
- update `packages/<crud>/src/server/repository.js` so list queries pass `listFilterContract.toJsonRestQuery(query)` into `buildJsonRestQueryParams(...)`
- update the page-local `listFilters.js` first; only edit `index.vue` if a specialist lookup label/runtime integration is needed
- for lookup-backed filters, wire `useCrudListFilterLookups(...)` beside the existing filter runtime instead of replacing `CrudListFilterSurface`

Standard route and action query composition:

```js
const {
  listRouteContract
} = createCrudJsonApiRouteContracts({
  resource,
  listFilterQueryValidator: recordsListFilterContract.queryValidator
});
```

```js
input: composeSchemaDefinitions([
  workspaceSlugParamsValidator,
  ...createStandardCrudListQueryValidators({
    resource,
    listFilterQueryValidator: recordsListFilterContract.queryValidator
  })
])
```

If `resource.contract.listFilters.queryValidator` already owns the filter
validator, pass only `{ resource }`. Append a validator after the standard
group only for genuinely additional, non-filter query input. Never supply the
same filter validator through both paths.

Do not reconstruct the standard list group from individual pagination,
search, parent-filter, include, or sparse-field validators. The group keeps
the independently validated route and action layers aligned as standard query
features evolve. Standard view actions use
`createStandardCrudViewQueryValidators()` for the same reason.

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
- manually rebuilding the standard CRUD list/view validator groups from individual validators
- appending a list-filter validator after `createStandardCrudListQueryValidators(...)` when it belongs in the dedicated `listFilterQueryValidator` option
- hand-rolled preset apply/reset/active-state helpers when `useCrudListFilters(..., { presets })`, `applyPreset(...)`, and `matchesPreset(...)` fit
- per-screen `useList()` wrappers for lookup-backed filters when `useCrudListFilterLookups(...)` fits
- editing `.vue` files just to add basic filter controls; use the page-local `listFilters.js` seam first
- overloading `q` with structured filter meaning
- inline filter-definition objects passed into `useCrudListFilters(...)`, `createCrudListFilters(...)`, or `createCrudListFilterContract(...)`; keep definitions in a named module
- assigning a default to `filterRuntime.values` after `useCrudListScreen(...)` has started; that changes the query after construction and can issue a second initial request

Good shape:
- `src/pages/home/customers/listFilters.js`
- `const listFilters = defineCrudListFilters({ status: { type: "enum", ... } })`
- page passes `listFilters` into `useCrudListScreen(...)`
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
- one filter definition source of truth: page-local `listFilters.js` for client-only filters, or a shared CRUD-package module when server code imports the same definitions
- server validator, JSON REST search schema, and repository query projection derived from that source through `createCrudListFilterContract(...)`
- route and action boundaries independently compose
  `createStandardCrudListQueryValidators(...)`, using the dedicated
  `listFilterQueryValidator` option when the resource does not already own it
- standard view actions compose `createStandardCrudViewQueryValidators()`
- client query params/chips/reset logic derived from that source
- initial route/default resolution completes before the first list request
- lookup-backed filters use the shared lookup helper, not a page-local mini-framework
- the two-phase server exception is intentional and documented, not accidental drift
