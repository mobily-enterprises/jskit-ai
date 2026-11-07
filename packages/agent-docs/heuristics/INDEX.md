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
- UI contract, design contract, navigation roles, Up arrow, Back button, declared parent, jskit.parent, in-app trail, history.back, hand-built links, jskit check, Deslop, density, placeholder copy, card shells, shared CRUD screens, row actions, synthetic rows, detail slots
  - [ui-contract.md](./ui-contract.md)
- filter, filters, search facets, chips, date range, enum filter, lookup filter, `useCrudListFilters`, `createCrudListFilters`
  - [filters.md](./filters.md)
- `searchSchema`, `search: true`, `applyFilter`, server search, query validators, backend filters, internal JSON REST filters
  - [server-search.md](./server-search.md)
- `actualField`, `storage.column`, `storage.writeSerializer`, `storage.virtual`, `queryFields`, computed field, virtual field, projection, `defaultTo`, datetime write serialization, temporalPrecision, json-rest-schema dates
  - [table-resource-fields.md](./table-resource-fields.md)
- data access, database table, knex, raw, SQL, repository, bulk, batch, many rows, set write, upsert, lock, claim, totals, report, aggregate, newest per group, transaction, `trx`, background job, system scope, `systemContext`, owner, owns, owner API, another feature's table, scope test, `expectFlatQueries`, `requireTestDatabase`, `jskit/no-direct-knex`, `jskit/no-transaction-reader`, `jskit/no-hand-scope`, `jskit/sql-literal`, `jskit/knex-reason`, `infrastructure:`
  - [data-access.md](./data-access.md)
- row policy, permission filtering, visibility before pagination, recursive CTE, descendants, package cycle, `RowPolicyPlugin`, row policy cost, slow writes through a policy, access check per history item
  - [row-policies.md](./row-policies.md)
- typed features, server feature, provider, service, repository, collaborator, `typeof`, `= null`, `setProvider`, `register`, `input || {}`, `payload = {}`, `async execute`, `Object.freeze`, `requires`, `optional`, `types.js`, `RuntimeKnex`, `silentLogger`, `create<Name>Actions`, `ActionSpecifications`, request context, `handle.query`, `queryAll`, every row, list stops at one page, `jskit/*` lint findings, `readable-check: allow`, `optional operation:`, `process.env`, `AppError` code, `Object.assign(new Error`, `idempotency`, `…ForTests` export, file or function size, read per row, N+1 queries, slow endpoint, query budget, realistic row counts, slow tests, raised timeout, `migrate.latest()` in tests, test database snapshot, `--test-concurrency=1`, `node --test`, `jskit test`, `testConcurrency()`, `V64_TEST_CONCURRENCY`, Playwright `workers`, Vitest `maxWorkers`, tests one file at a time, test files colliding in parallel, `jskit-test: alone`, `test/*` findings of `jskit check`
  - [typed-features.md](./typed-features.md)
- client features, composable, `use<Name>`, Vue component, client provider, props, emits, `inject`, `provide`, `ref`, `reactive`, `watch`, `addEventListener`, `setInterval`, module state, `Object.freeze` on a composable, `?.()` in a template, `jskit/typed-inject`, `jskit/collaborator-props`, `jskit/fixed-result-shape`, `jskit/released-listeners`, `jskit/no-module-state`, `jskit/no-frozen-vue-state`, `clientFeaturesConfig`, `shared resource:`
  - [client-features.md](./client-features.md)
- sanity checks, is this sane, query count that grows with the rows, a list that stops at 20 or 100 rows, `createDocument()` per row of a batch, `jskit test`, one file at a time, test database preparation, `TEST_DB_NAME`, `mode: "patch"`, a route `rateLimit` nothing tests, `input.workspaceId`, a refactor or consolidation that drops behaviour, a JSKIT update, a changed theme or Vuetify default, `jskit.surface` with a parent, an assistant tool's output contract, a screen that renders everything, feedback covering an action, `NODE_ENV=production`, a production start
  - [Sanity checks](../site/guide/framework/sanity-checks.md)
