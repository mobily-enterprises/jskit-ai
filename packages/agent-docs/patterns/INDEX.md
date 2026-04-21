# JSKIT Patterns Index

Use this index as the first stop for recurring JSKIT implementation heuristics and workflow traps.

How to use it:

- Match the user request against the keywords below.
- Open only the relevant pattern files.
- Use patterns as implementation guidance, not as permission to skip normal scoping or user clarification.

## Keyword Map

- tabs, menu items, icons, shell links, profile links, subpage tabs, placements
  - `placements.md`
- surfaces, app/admin/home/console, "which surface", route ownership, placement visibility
  - `surfaces.md`
- child crud, nested crud, embedded list, subroute, separate page, parent/child layout
  - `child-cruds.md`
- CRUD links, record placeholders, `paths.page()`, `resolveViewUrl`, `resolveEditUrl`, `resolveParams`
  - `crud-links.md`
- live actions, checkbox, toggle, patch button, inline action, `useCommand()`
  - `live-actions.md`
- ajax, fetch, API call, request, endpoint, HTTP client, `useList()`, `useView()`, `useAddEdit()`, `useEndpointResource()`, `usersWebHttpClient`
  - `client-requests.md`
- playwright, browser test, e2e, ui verification, authenticated ui test, test auth, dev login as, dev auth bypass
  - `ui-testing.md`
- filter, filters, search facets, chips, date range, enum filter, lookup filter, `useCrudListFilters`, `createCrudListFilters`
  - `filters.md`
- fieldMeta, `repository.column`, computed field, virtual field, projection, `createCrudResourceRuntime`, `remainingBatchWeight`
  - `crud-repository-mapping.md`

## Current Patterns

- [placements.md](./placements.md)
- [surfaces.md](./surfaces.md)
- [child-cruds.md](./child-cruds.md)
- [crud-links.md](./crud-links.md)
- [live-actions.md](./live-actions.md)
- [client-requests.md](./client-requests.md)
- [ui-testing.md](./ui-testing.md)
- [filters.md](./filters.md)
- [crud-repository-mapping.md](./crud-repository-mapping.md)
