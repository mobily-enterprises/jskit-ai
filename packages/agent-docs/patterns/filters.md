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
3. Use the runtime's `queryValidator` in routes/actions and `applyQuery(...)` in the repository.
4. Build the client runtime from the same shared definitions with `useCrudListFilters(...)`.
5. Pass `listFilters.queryParams` into `useCrudList(...)`.
6. For lookup-backed filters, use `useCrudListFilterLookups(...)` instead of hand-rolling `useList()` in each page.

Keep separate:
- free-text search uses `records.searchQuery` and `q`
- structured filters use explicit query params through `useCrudListFilters(...)`

Use `useCrudListFilterLookups(...)` when:
- a filter is `recordId` or `recordIdMany`
- the UI needs remote autocomplete search
- chips should show readable labels instead of raw ids

Put unusual SQL semantics on the server:
- examples: `pending` meaning `whereNull("ccp1_passed")`, or `assigned/unassigned` meaning `whereNotNull(...)` / `whereNull(...)`
- implement those in `createCrudListFilters(..., { apply: { ... } })`

Avoid:
- local filter composables that duplicate the same keys the server already knows about
- a custom validator shape that does not match the page state
- per-screen `useList()` wrappers for lookup-backed filters when `useCrudListFilterLookups(...)` fits
- overloading `q` with structured filter meaning

Good shape:
- `packages/receivals/src/shared/receivalListFilters.js`
- `createCrudListFilters(RECEIVAL_LIST_FILTER_DEFINITIONS, ...)`
- `const listFilters = useCrudListFilters(RECEIVAL_LIST_FILTER_DEFINITIONS)`
- `const filterLookups = useCrudListFilterLookups(RECEIVAL_LIST_FILTER_DEFINITIONS, { values: listFilters.values, ... })`
- `queryParams: listFilters.queryParams`

Review checks:
- one shared filter definition source of truth
- server validator/repository logic derived from that source
- client query params/chips/reset logic derived from that source
- lookup-backed filters use the shared lookup helper, not a page-local mini-framework
