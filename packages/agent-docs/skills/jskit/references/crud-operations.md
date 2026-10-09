<!-- Generated from `packages/agent-docs/site/guide/framework/crud-operations.md` by `npm run agent-docs:build`. -->

# CRUD operations

## Establish the product contract

Take database, surface, access, ownership, operations, and fields from product
intent and current source. Ask when a material choice is missing. Do not
translate the work into generator options.

Read the narrow package-owned pattern in the [bundled source pattern index](pattern-index.md): `crud/resource-contract` for the resource,
`crud/json-api-resource-package` for the server, and `crud/crud-screen-set`
for routed UI. Child-resource and row-policy patterns own those variations.

Normal CRUD tables use one non-null integer primary key. Foreign keys are
single-column; composite unique indexes are business constraints, not
identities. Only direct `workspace_id` and `user_id` columns imply ownership.
Match visibility to real ownership and test allowed plus cross-owner cases.

## Author the resource normally

1. Write an immutable app-owned migration.
2. Define the shared resource contract through `defineCrudResource()`.
3. Use `defineCrudJsonApiFeature()` for standard repository, service, action,
   permission, resource-host, and route mechanics.
4. Customize through `decorateRepository`, `decorateService`,
   `operationLifecycle`, and named `actions`; do not copy the standard CRUD
   repository/action/route stack.
5. Build routed screens from the matching `http-web`/CRUD UI pattern.

The resource is canonical for fields, operations, validation, transport,
messages, and route parameters. Do not duplicate its schema or serializers.
Prefer `useCrudListScreen()`, `useCrudViewScreen()`, and
`useCrudAddEditScreen()`; use `useCommand()` or `useEndpointResource()` for
non-standard operations.

Add resource service methods with `decorateService`; expose commands such as
`confirm`, `publish`, or `cancel` through named `actions`. With `operationLifecycle`, mutation `before`,
`execute`, and `after` share one repository transaction, `execute` receives
`standard(nextInput)`, and `afterCommit` follows commit. Repositories persist;
services and hooks orchestrate. Use a transactional outbox for durable
external work.

## Choose ownership, API access and client access independently

These controls answer different questions:

| Control | Purpose | Public records | Owner-scoped records |
| --- | --- | --- | --- |
| Resource `autofilter` | Which rows belong to the request scope | `"public"`; no ownership column | `"user"`; real non-null `userId` column |
| Resource `apiAccess` | Who may call the API | `"public"` | `"authenticated"` |
| Feature `ownershipFilter` | Server route/action ownership scope | `"public"` | `"user"` |
| Client `access` | Whether to require bootstrap permissions | Default `"auto"` with no permission requirements | Default `"auto"`; declare permissions when required |

`access` accepts `auto`, `always`, or `never`, not `public`. With `auto`, a
screen with no permission requirements does not require a permissions bootstrap.
`always` does require it. Do not add authentication or workspace machinery to
compensate for an unnecessary `always` override. Server access and ownership
remain authoritative.

The Books source patterns demonstrate user ownership. For an intentionally
public create/list resource, use the same patterns with this resource contract:

```js
const bookResource = defineCrudResource({
  namespace: "books",
  tableName: "books",
  apiAccess: "public",
  autofilter: "public",
  crudOperations: ["list", "view", "create"],
  schema: {
    title: {
      type: "string",
      required: true,
      minLength: 1,
      maxLength: 255,
      operations: {
        output: { required: true },
        create: { required: true }
      }
    }
  },
  searchSchema: {
    q: {
      type: "string",
      oneOf: ["title"],
      filterOperator: "like",
      splitBy: " ",
      matchAll: true
    }
  }
});
```

Import `defineCrudResource` from
`@jskit-ai/resource-crud-core/shared/crudResource`. Its app-owned migration
creates `books` with an integer primary key `id` and non-null `title`; omit
`userId` and its foreign key for this public variant. `list` requires `view`
in the shared resource contract, even when the UI has no detail page. A create
response uses the resource output contract. Keep operation names such as
`list`, `view` and `create`; do not invent output-operation aliases.

Bind `defineCrudJsonApiFeature()` with this resource, `ownershipFilter:
"public"`, `relativePath: "/books"` and the application's configured public
surface. Keep the existing package/provider and migration registration from
`crud/json-api-resource-package`.

For the list, keep `BookListPage.vue` thin: use `resourceNamespace: "books"`
in `useCrudListScreen()` on the configured public surface, remove unsupported
edit/delete actions and optional author/notes filters, and point **New** to
the create route. For the new page, use the title field only and set:

```js
addEditOptions: {
  apiSuffix: "/books",
  ownershipFilter: "public",
  queryKeyFactory: (surfaceId = "") => ["crud", "books", surfaceId, "new"],
  readEnabled: false,
  writeMethod: "POST",
  listUrlTemplate: "/books"
},
saveSuccess: {
  invalidateQueryKey: ["crud", "books"],
  navigateToView: false,
  listUrlTemplate: "/books"
}
```

List/view screen wrappers derive request scope from the configured surface;
they do not expose an `ownershipFilter` option. Use a surface without workspace
route parameters for this public example. Form options and lower-level request
composables accept `ownershipFilter` explicitly.

New/Edit form runtimes require `queryKeyFactory` even with reads disabled.
For editing, include the reactive record id; for workspace-scoped resources,
include the route scope too. List/view screen wrappers derive standard keys
from `resourceNamespace`. Leave `access` at its default when no permissions
are declared. Verify create, list, blank-name rejection and reload persistence
without signing in for this public variant; owner-scoped variants additionally
need cross-owner denial tests.

## Save navigation

`useCrudAddEditScreen()` accepts `saveSuccess` at the top level. After saving,
the default behaviour invalidates `saveSuccess.invalidateQueryKey`, navigates
to a configured record-view URL when one resolves, and otherwise falls back to
the list URL. For a create-and-list app, use `navigateToView: false` and the
configured `listUrlTemplate`, as in the public example above. The list URL may
also come from `addEditOptions.listUrlTemplate`.

To keep the saved form open, set both `saveSuccess.navigateToView` and
`saveSuccess.navigateToList` to `false`. `addEditOptions.onSaveSuccess` replaces
the default success handling, including query invalidation and navigation;
reserve it for custom success behaviour. Returning to the list needs only the
documented `saveSuccess` options, not a custom router callback or inspection of
the shared form implementation.

## Browser routes and responsive lists

`newUrlTemplate`, `viewUrlTemplate`, `editUrlTemplate`, `listUrlTemplate`, and
`cancelTo` describe browser routes, not surface-relative API suffixes. Include
the configured surface prefix: if a public library lives at `/library`, its new
page is `/library/new` and its list is `/library`, not `/new` and `/`. For links
without record placeholders, `paths.page()` can resolve the configured surface;
for record placeholders use the current CRUD runtime's `resolveParams()`.
Request-scope inference does not add missing prefixes to browser links.

`CrudListScreen` uses `createLabel` for its toolbar, empty-state and compact
create actions. Its card and table layouts coexist in the DOM, with CSS choosing
the visible layout. Browser assertions on record text must select the visible
match, for example `page.getByText(title, { exact: true }).filter({ visible: true })`.
When the same create action appears in more than one visible location, choose
one visible action deliberately; do not relax the expected label to accept an
unrelated fallback.

## Browser tests verify validation and persistence

Exercise rejected and accepted input through the same form. Check the rendered
validation message and that rejection keeps the form open; then save an accepted
value and prove it appears in the list after reloading. Use the resource's
configured messages, the screen's `saveLabel`, and its actual browser routes.
Do not infer an `aria-invalid` attribute from the fact that validation exists:
the chosen field must actually implement that attribute contract before a test
can assert it.

For the public title-only Books variant above, using the pattern's
`saveLabel: "Save book"`, default minimum-length message, and a root public
surface:

```ts
await page.goto("/books");
await page.getByRole("link", { name: "Add book", exact: true }).filter({ visible: true }).first().click();
await expect(page).toHaveURL(/\/books\/new$/);
await page.reload();
const title = page.getByRole("textbox", { name: "Title", exact: true });
const save = page.getByRole("button", { name: "Save book", exact: true });
await title.fill("");
await save.click();
await expect(page.getByText("Length must be at least 1 characters.", { exact: true })).toBeVisible();
await expect(page).toHaveURL(/\/books\/new$/);

await title.fill("A saved book");
await save.click();
await expect(page).toHaveURL(/\/books$/);
await expect(page.getByText("A saved book", { exact: true }).filter({ visible: true })).toBeVisible();
await page.reload();
await expect(page.getByText("A saved book", { exact: true }).filter({ visible: true })).toBeVisible();
```

For client-side routing, a click finishing does not prove the route has changed.
Before reloading after a navigation control, wait for the destination with
`await expect(page).toHaveURL(...)`, as above. Otherwise reload can reopen the
origin page and a later form or Back locator waits on the wrong screen. Use the
actual destination URL, including required context; do not add fixed sleeps or
increase timeouts to hide this race. For a contextual Back check, wait for the
form route, reload, click Back, and assert the original list URL. Test direct
entry separately against the configured fallback.

Keep the application's existing browser configuration and isolated fixtures.
Adapt the route, labels and configured error message to that application's
contract, and retain compact, medium and expanded layout coverage. Direct API
checks additionally prove rejected input is not persisted.

## Wire list search with the initial resource

`useCrudListScreen()` enables query search and the shared list renders a Search
box. When using that screen, configure `resource.searchSchema.q` with the
searchable fields from the start, as in the title-only Books resource above.
Showing a Search box alone does not implement storage filtering. Keep the
mapping in the resource; do not add page-local filtering or duplicate request
code. The full Books source example maps `q` to title, author and notes; narrow
it when adapting the example to fewer fields.

The browser page's route query and internal CRUD query use plain `q`. The
JSON:API HTTP transport uses `filter[q]`. Shared CRUD clients encode and decode
this automatically. Raw HTTP/API tests must send the transport key themselves:

```ts
const headers = { Accept: "application/vnd.api+json" };
const matches = await request.get("/api/books", {
  headers, params: { "filter[q]": "A saved book" }
});
expect(matches.status()).toBe(200);
expect((await matches.json()).data.some(book => book.attributes.title === "A saved book")).toBe(true);

const noMatches = await request.get("/api/books", {
  headers, params: { "filter[q]": "no-matching-fixture-title" }
});
expect(noMatches.status()).toBe(200);
expect((await noMatches.json()).data).toEqual([]);
```

Use controlled fixtures with a known matching and nonmatching value. A matching
row alone does not prove search works: an unfiltered response also includes it.
In the browser, fill Search, assert the expected visible rows and excluded rows,
then clear it and assert the list returns. Verify route/reload behaviour when
the screen synchronizes search to the route. Add these checks to the initial
create/list flow rather than discovering an unwired control at final review.

## Direct API tests use JSON:API documents

JSKIT's CRUD screens and HTTP client apply the resource's JSON:API transport
automatically. Direct Playwright `request` calls and other raw HTTP clients must
supply that transport themselves. An ordinary JSON body such as `{ title }`
with `Content-Type: application/json` does not test field validation on a
JSON:API route; it is rejected as an unsupported media type (HTTP 415).

Use the application's actual API base and scope, not its page URL. For the
public Books resource above, with API base `/api` and transport type `books`:

```js
const headers = {
  "Content-Type": "application/vnd.api+json",
  Accept: "application/vnd.api+json"
};
const response = await request.post("/api/books", {
  headers,
  data: {
    data: {
      type: "books",
      attributes: { title: "Kindred" }
    }
  }
});
expect(response.status()).toBe(201);
const document = await response.json();
expect(document.data.attributes.title).toBe("Kindred");
```

Keep the same headers and `data.type/attributes` envelope when testing invalid
field values; for this contract, an empty `title` or one over 255 characters
should return HTTP 400. Raw responses contain fields under `data.attributes`,
while the shared client simplifies resource responses. A collection response
has an array in `data`. Match `data.type` to the configured resource transport;
retain the application's existing identity and CSRF fixture for protected APIs.
Prefer the shared resource client for application requests rather than copying
this raw test encoding into page code.

## Record deletion

Deletion requires an explicit shared `DELETE` operation and confirmation
decision. Use `CrudDeleteAction` and `useCrudDeleteAction()` through the view
actions slot; do not rebuild their confirmation, request, invalidation, and
navigation flow.

The delete action resolves its HTTP client from the resource's `apiAccess`, just
like the list, view and form helpers. For `apiAccess: "public"`, DELETE requests
skip session CSRF discovery; no `/api/session` endpoint or page-local client
wiring is required. Authenticated resources retain the configured client's CSRF
behavior. An explicit `client` override is supported and receives the same
resource-aware public request options. This does not change server authorization.

For custom form actions, see
[record form actions](https://mobily-enterprises.github.io/jskit-ai/guide/framework/crud-form-actions).

## Strict temporal values

With `json-rest-schema` 1.0.17, temporal resource values are strings:

- `date`: `YYYY-MM-DD`
- `time`: offset-free `HH:MM[:SS[.fraction]]`
- `dateTime`: RFC 3339 with seconds and `Z` or a numeric offset

Convert JavaScript `Date` objects at the boundary, normally with
`toISOString()`. Numeric epochs use `epochMilliseconds` or `epochSeconds`.
Honor `temporalPrecision`; repositories return strict strings.

## Migration ownership

Migrations are immutable application source owned with their resource. Never
make a live table or a generator the sole source of truth. Inspect schemas for
adoption and diagnosis; inspection is optional.

Read [ordering and recovery](https://mobily-enterprises.github.io/jskit-ai/guide/app-setup/database-layer#directory-order-comes-before-filenames)
before schema work; check Knex configuration and ledger.
`createKnexMigrationConfigFromApp()` uses `sortDirsSeparately: true`: root
`migrations/`, sorted package directories, then `migrations/constraints/`.
Timestamps order only within directories. Keep tables/columns with their package;
put cross-package foreign keys in the final phase.

MySQL/MariaDB can leave committed DDL without a ledger entry. Check columns and
keys separately; `hasColumn()` is insufficient. Validate existing definitions,
complete missing work, and plan recovery for blocked steps. Preserve applied
bodies and relocated basenames. Never disable foreign-key checks or skip parents.

On the selected engine, prove fresh preparation, upgrades preserving rows,
partial-DDL retries, and a second preparation with no pending migrations.
Inspect constraints and test rejected references and delete behavior.

Do not create a workboard entry, ownership receipt, generation record, or
historical proof that tooling ran.
