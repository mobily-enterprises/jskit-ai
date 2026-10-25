# JSKIT Heuristics Index

Use this index for recurring JSKIT implementation heuristics and workflow traps.
Source patterns with complete example trees are listed separately in the source
pattern index.

How to use it:

- Match the user request against the keywords below.
- Open only the relevant heuristic files.
- Use heuristics as implementation guidance, not as permission to skip normal scoping or user clarification.

## Keyword Map

- tabs, menu items, icons, shell links, profile links, subpage tabs, placements
  - [placements.md](./placements.md)
- surfaces, app/admin/home/console, "which surface", route ownership, placement visibility
  - [surfaces.md](./surfaces.md)
- page, route page, placeholder page, screen stub, menu-linked page, placements
  - [page-scaffolding.md](./page-scaffolding.md)
- child crud, nested crud, embedded list, subroute, separate page, parent/child layout
  - [child-cruds.md](./child-cruds.md)
- crud, crud server, crud ui, resource contract, table creation, migrations, ownership, JSON API, standard screens
  - [crud-authoring.md](./crud-authoring.md)
- CRUD links, record placeholders, `paths.page()`, `resolveViewUrl`, `resolveEditUrl`, `resolveParams`
  - [crud-links.md](./crud-links.md)
- `definePage`, redirect, child redirect, settings landing, `redirectToChild`
  - [page-redirects.md](./page-redirects.md)
- live actions, checkbox, toggle, patch button, delete confirmation, destructive action, inline action, `useCommand()`, `useCrudDeleteAction()`
  - [live-actions.md](./live-actions.md)
- ajax, fetch, API call, request, endpoint, HTTP client, `useCrudListScreen()`, `useCrudViewScreen()`, `useCrudAddEditScreen()`, `useList()`, `useView()`, `useAddEdit()`, `useEndpointResource()`, `httpWebClient`
  - [client-requests.md](./client-requests.md)
- playwright, browser test, e2e, ui verification, baseline test, authenticated ui test, test auth, dev login as, dev auth bypass
  - [ui-testing.md](./ui-testing.md)
- UI contract, design contract, navigation roles, Back button, previous page, history, hardcoded destination, Deslop, density, placeholder copy, card shells, shared CRUD screens, row actions, synthetic rows, detail slots
  - [ui-contract.md](./ui-contract.md)
- filter, filters, search facets, chips, date range, enum filter, lookup filter, `useCrudListFilters`, `createCrudListFilters`
  - [filters.md](./filters.md)
- `searchSchema`, `search: true`, `applyFilter`, server search, query validators, backend filters, internal JSON REST filters
  - [server-search.md](./server-search.md)
- `actualField`, `storage.writeSerializer`, `storage.virtual`, computed field, virtual field, projection, `createCrudResourceRuntime`, datetime write serialization, temporalPrecision, json-rest-schema dates
  - [crud-repository-mapping.md](./crud-repository-mapping.md)
- row policy, permission filtering, visibility before pagination, recursive CTE, descendants, package cycle, `RowPolicyPlugin`
  - [row-policies.md](./row-policies.md)
