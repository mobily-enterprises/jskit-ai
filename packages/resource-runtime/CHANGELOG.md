# Changelog

## Unreleased

- **Breaking: the package is now `@jskit-ai/resource-runtime`** (was `@jskit-ai/json-rest-api-core`), on json-rest-api 3.0.0. Its provider is `ResourceRuntimeProvider`, which provides `runtime.resources`; the host it builds is `createResourceHost` (was `createJsonRestApiHost`), at `./server/resourceHost` (was `./server/jsonRestApiHost`). Until crud-core, users-core and workspaces-core own their tables through `runtime.resources`, the same provider also provides the host as `runtime.json-rest-api`, with the host helpers they use.
- **`runtime.resources`.** The kernel calls `own(featureId, owns)` for a feature with `owns`: it registers each table resource (or `{ resource, rowPolicy, hooks: { afterWrite }, acceptsContributions, normalizeId, queryFields, searchSchema }`) under its name, throws `DuplicateOwnerError` when another feature owns the table or the name, and answers one handle per resource. `createSystemContext({ feature, systemScope, reason })` answers json-rest-api's system context, with `forWorkspace(id)` and `forUser(id)` for work scoped to one workspace or user.
- **Handles.** Every method takes `options = { context, trx }` last and refuses an owned resource's call without a context (`MissingScopeError`). Reads: `query(params)` answers `{ records, page: { size, hasMore, next } }` and requires `page.size` (`UnpagedQueryError`) no larger than the resource's page limit (`PageSizeError`); `queryAll` reads in 1,000-row pages and, in a request context, throws `RowLimitError` past 10,000 rows (system, workspace and user job contexts have no limit); `get` answers a record or null; `aggregate` answers rows. Writes: `create`, `patch` (`lockVersion` throws `StaleRecordError`, 409 `crud.document.lockVersionConflict`; `onlyIf` patches only matching rows) and `delete`, and the many-row `createMany`, `patchMany`, `patchWhereIds`, `patchWhere`, `deleteMany` and `deleteWhere`, one statement per chunk. An upsert's rows carry no id, and `patchWhere` and `deleteWhere` with empty filters need `all: true`. Locks: `lock`, `lockMany`, `lockWhere`, `claim`. Escape hatch: `scopedQuery` answers `{ query }`, a read-only builder with ownership and the row policy applied, with `column`, `raw` and `toRecords`. `withTransaction(options, work)` runs work in the caller's transaction or one it opens and retries on a deadlock. `afterWrite` hooks run once per write in its transaction and scope.
- Handles answer `inTransaction(options)`: whether a call runs inside a transaction, without handing out the transaction. It is the one reader for protocol guards, for work that must run inside the caller's transaction or must open its own.
- A system context also derives `forWorkspaceUser(workspaceId, userId)`: one user's context inside one workspace, so a `workspace_user` table reads that user's rows in that workspace, a `workspace` table the workspace's and a `user` table the user's. Both ids are required.
- **Row policies** receive `ownTable(name)`, a SELECT-only builder over the owner's own tables, and a resource whose owner says `acceptsContributions` takes other features' `contributeRowPolicy(name, policy)`: each contribution is ANDed with the owner's policy inside its own group, so it only narrows.
- **`workspace_or_shared`** ownership reads a workspace's rows and the rows whose workspace is null, and writes only its own.
- **`./test`:** `expectScoped`, `expectFlatQueries` (moved from database-runtime; it now allows the later chunks a many-row write reports), `expectEveryTableOwned`, `requireTestDatabase` and `createTestResourceRuntime`.
- **Breaking (data-access redesign).** `createJsonRestResourceScopeOptions(resource, options)` takes a table resource from `@jskit-ai/resource-core`'s `defineTableResource` and throws for anything else. Its `ownership` becomes json-rest-api's `autofilter` preset (none for `public`). `name`, `ownership` and `defaultExclude` do not reach json-rest-api. A `workspace_or_shared` table throws until the resource runtime serves it on json-rest-api 3.0.0. Register the table under the resource's `name`.
- Depends on json-rest-api 2.4.0 (from 2.1.0). Every-row reads now get their 1,000-row pages (480 rows: 3 statements and 3 policy runs instead of 15 and 15 in JSKIT's measurement fixture); writes skip the post-write refresh nothing observes (a created child: 9 statements and 5 policy runs instead of 11 and 7); linkage checks run one query per type; reads copy records for `originalRecord` only for hooks that can read it (a query of 100 rows of 38 KB: about a third of the CPU). Also from 2.2.0-2.3.1: `aggregate()`, `email` and `uuid` field types, `retired: true` fields, AnyAPI indexed slots, and relationship targets locked FOR SHARE instead of FOR UPDATE.
- New `queryAllJsonRestCollectionDocument(resource, params, context)`: every row a query matches as one JSON:API document `{ data, included }`, with each page's included records kept once, for server reads that use `include`. CRUD repositories' `queryEveryDocument` reads through it.
- `queryAllJsonRestCollectionRows` asks for 1,000-row pages (or the resource's `queryMaxLimit` when larger) through json-rest-api's server-only `pageSizeLimit`, so an every-row read pays each page's row policy and linkage queries once per 1,000 rows instead of once per 100: 480 rows read in 3 statements instead of 15. json-rest-api before 2.4.0 ignores `pageSizeLimit` and keeps 100-row pages; the result is the same rows either way. HTTP page sizes are unchanged.

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".

### New message keys (2)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.errors.REST_API_VERSION_CONFLICT`
- `jskit.errors.REST_API_PRECONDITION_FAILED`

</details>
