# Structured Filters

Use when:
- a CRUD list needs flags, enums, date ranges, record-id filters, or lookup-backed filters
- the user asks to "add a filter", "make the list filterable", or "keep filters in the URL"
- a screen mixes free-text search with structured facets

Ask first:
- which fields are filterable
- whether each filter is a flag, enum, multi-enum, date/date-range, number-range, record id, or lookup-backed record id
- whether filters must sync to the route query
- whether the screen needs chips and clear/reset behavior
- whether lookup filters need remote autocomplete search
- whether there are presets such as "Today", "Last 7 Days", or "Only Archived"

Default JSKIT pattern:
1. Put shared filter definitions in the CRUD package.
   Example path: `packages/<crud>/src/shared/<crud>ListFilters.js`
2. Build the server runtime from that module with `createCrudListFilters(...)`.
3. Build route/action validators explicitly with `createQueryValidator({ invalidValues: "reject" | "discard" })`, and use `applyQuery(...)` in the repository. There is no default validator mode and no `runtime.queryValidator` alias.
4. Build the client runtime from the same shared definitions with `useCrudListFilters(...)`. Presets can use static `values` or dynamic `resolveValues({ values, filters, presetKey, preset })`.
5. Pass `listFilters.queryParams` into `useCrudList(...)`.
6. For lookup-backed filters, use `useCrudListFilterLookups(...)` instead of hand-rolling `useList()` in each page.

Exact file checklist:
- create `packages/<crud>/src/shared/<crud>ListFilters.js`
- update `packages/<crud>/src/server/registerRoutes.js` and `packages/<crud>/src/server/actions.js` so the list query validator includes an explicit `createQueryValidator({ invalidValues: ... })` choice, or update `packages/<crud>/src/server/listQueryValidators.js` if that package already extracts list-query composition there
- update `packages/<crud>/src/server/repository.js` so list queries call the runtime's `applyQuery(...)`
- update the app-owned list page or list-runtime composable under `src/pages/...` or `src/composables/...` so it builds `useCrudListFilters(...)`, passes `queryParams` into `useCrudList(...)`, and binds chips / reset behavior
- for lookup-backed filters, update that same client file to build `useCrudListFilterLookups(...)` and bind the lookup control from `resolveLookup(...)`

Validation mode is part of the contract:
- there is no default mode and no fallback alias, so every route/action boundary that validates structured filters must call `createQueryValidator({ invalidValues: ... })` explicitly
- use `invalidValues: "reject"` when malformed filter values should fail validation and return a 400-style contract error
- use `invalidValues: "discard"` when malformed filter values should be ignored and normalization should drop them
- route query validation runs before auth, so this choice affects whether malformed unauthenticated requests fail at validation or fall through to auth
- for normal HTTP CRUD handlers, route-level `discard` means the action layer receives already-normalized query input; do not assume route `discard` plus action `reject` will still reject malformed HTTP query strings later
- `jskit doctor` flags `createQueryValidator(...)` calls that do not spell out `invalidValues` directly at the call site

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
- implement those in `createCrudListFilters(..., { apply: { ... } })`
- do not use custom `apply` just for null/not-null checks when `type: "presence"` fits

Avoid:
- local filter composables that duplicate the same keys the server already knows about
- a custom validator shape that does not match the page state
- assuming a default `runtime.queryValidator` exists; always create the validator explicitly with `createQueryValidator({ invalidValues: ... })`
- hand-rolled preset apply/reset/active-state helpers when `useCrudListFilters(..., { presets })`, `applyPreset(...)`, and `matchesPreset(...)` fit
- per-screen `useList()` wrappers for lookup-backed filters when `useCrudListFilterLookups(...)` fits
- a second page-local filter-definition file when `packages/<crud>/src/shared/<crud>ListFilters.js` should be the source of truth
- overloading `q` with structured filter meaning
- local or inline filter-definition objects passed into `useCrudListFilters(...)` or `createCrudListFilters(...)`; `jskit doctor` expects those runtimes to import from a CRUD shared `*ListFilters` module

Good shape:
- `packages/receivals/src/shared/receivalListFilters.js`
- `createCrudListFilters(RECEIVAL_LIST_FILTER_DEFINITIONS, ...)`
- `const listFilters = useCrudListFilters(RECEIVAL_LIST_FILTER_DEFINITIONS, { presets: [...] })`
- `const filterLookups = useCrudListFilterLookups(RECEIVAL_LIST_FILTER_DEFINITIONS, { values: listFilters.values, ... })`
- `queryParams: listFilters.queryParams`

Preset contract notes:
- `resolveValues({ values, filters, presetKey, preset })` receives the current filter state and the normalized preset metadata, so relative-date presets can derive values at apply time without page-local helper state
- `matchesPreset(...)` compares against the full current filter state after basic normalization; it does **not** silently drop extra `enumMany` or `recordIdMany` values that were hydrated from the route and still show up as active chips
- if the URL contains `status=archived&status=bogus`, a preset for only `archived` should not render as active while the `bogus` chip is still visible

Review checks:
- one shared filter definition source of truth
- server validator/repository logic derived from that source
- client query params/chips/reset logic derived from that source
- lookup-backed filters use the shared lookup helper, not a page-local mini-framework
- `jskit doctor` stays clean for filter ownership and explicit validator policy
