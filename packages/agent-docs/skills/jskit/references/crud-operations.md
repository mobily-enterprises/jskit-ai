# CRUD operations

Read this completely before database, schema, CRUD, repository, or persistence
work.

## Establish the product contract

Take the database, surface, access, ownership, operations, and fields from the
request, current application, and product documentation. Ask when a material
choice is missing. Do not translate the work into generator options.

Inspect the generated source pattern index and read the narrow matching
package-owned pattern. `crud/resource-contract` is the baseline shared resource
example, `crud/json-api-resource-package` owns standard server composition, and
`crud/crud-screen-set` owns the routed list, view, create, edit, and delete UI.
Child-resource and row-policy patterns own their respective variations.

Normal app-owned CRUD tables use one non-null integer primary key. Every
foreign key is single-column and targets that key; multi-column unique indexes
are business constraints, never relationship targets. Only direct
`workspace_id` and `user_id` columns are reserved ownership. Names such as
`recipient_user_id` are domain relationships. Match mandatory visibility to
the actual ownership columns and test allowed plus cross-owner cases.

## Author the resource normally

For a conventional resource:

1. Write an immutable app-owned migration.
2. Define the shared resource contract through `defineCrudResource()`.
3. Use `defineCrudJsonApiFeature()` for standard repository, service, action,
   permission, resource-host, and route mechanics.
4. Write only product-specific validation, policy, queries, messages, and
   orchestration in application code.
5. Build routed screens from the matching `http-web`/CRUD UI pattern.

The shared resource is canonical for names, fields, operations, validation,
transport, messages, and route parameters. Do not hand-build a second request
schema, raw-fetch client, or UI-only serializer. Prefer the high-level
`useCrudListScreen()`, `useCrudViewScreen()`, and `useCrudAddEditScreen()`
contracts for standard screens; use `useCommand()` and
`useEndpointResource()` for genuinely non-standard operations.

## Record deletion

Deletion requires an explicit shared `DELETE` operation and a product decision
about confirmation. Standard routed deletion uses `CrudDeleteAction` and
`useCrudDeleteAction()` through the view actions slot. The shared component
owns confirmation UI; `useCommand()` owns pending/error feedback and request
execution; success invalidates the list and returns to it. Do not rebuild this
with raw `fetch()` or an app-specific transport helper.

## Strict temporal values

With `json-rest-schema` 1.0.17, temporal resource values are strings:

- `date`: `YYYY-MM-DD`
- `time`: offset-free `HH:MM[:SS[.fraction]]`
- `dateTime`: RFC 3339 with seconds and `Z` or a numeric offset

Do not pass JavaScript `Date` objects through resource validation; convert at
the boundary (normally `toISOString()` for `dateTime`). Numeric epochs use
`epochMilliseconds` or `epochSeconds`. Honor `temporalPrecision` without
silently truncating fractions. Database repositories return strict strings.

## Migration ownership

Migrations are immutable application source. Author them in the package that
owns the resource and use the database runtime's public migration contract.
Never make a live table or a generator the sole source of truth. Read-only
schema inspection is useful when adopting or diagnosing an existing database,
not as compulsory authoring.

Before sign-off, rebuild from zero in a fresh disposable database, compare the
schema, test ownership boundaries and failure cases, and run current-state
verification. Do not create a workboard entry, ownership receipt, generation
record, or historical proof that tooling ran.
