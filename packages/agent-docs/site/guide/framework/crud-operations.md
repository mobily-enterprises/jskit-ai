---
title: CRUD operations
description: Implement JSKIT database resources, repositories, services, actions, and CRUD screens through public framework seams.
---

# CRUD operations

## Establish the product contract

Take database, surface, access, ownership, operations, and fields from product
intent and current source. Ask when a material choice is missing. Do not
translate the work into generator options.

Read the narrow package-owned pattern in the [source pattern
library](/patterns/): `crud/resource-contract` for the resource,
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

## Record deletion

Deletion requires an explicit shared `DELETE` operation and confirmation
decision. Use `CrudDeleteAction` and `useCrudDeleteAction()` through the view
actions slot; do not rebuild their confirmation, request, invalidation, and
navigation flow.

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
