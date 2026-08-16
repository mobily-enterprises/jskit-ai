# CRUD operations

Read this before database, schema, CRUD, repository, or persistence work.

## Establish the product contract

Take database, surface, access, ownership, operations, and fields from product
intent and current source. Ask when a material choice is missing. Do not translate the work into generator options.

Read the narrow package-owned pattern from the generated index:
`crud/resource-contract` for the resource, `crud/json-api-resource-package` for
the server, and `crud/crud-screen-set` for routed UI. Child-resource and
row-policy patterns own those variations.

Normal CRUD tables use one non-null integer primary key. Foreign keys are
single-column; composite unique indexes are business constraints, not
identities. Only direct `workspace_id` and `user_id` columns imply ownership.
Match visibility to real ownership and test allowed plus cross-owner cases.

## Author the resource normally

For a conventional resource:

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

Additional resource service methods are normal. Add them with
`decorateService`; expose commands such as `confirm`, `publish`, or `cancel`
through named `actions`. With `operationLifecycle`, mutation `before`,
`execute`, and `after` share one repository transaction, `execute` receives
`standard(nextInput)`, and `afterCommit` follows commit. Repositories persist;
services and hooks orchestrate them. Durable external work uses a transactional
outbox.

## Record deletion

Deletion requires an explicit shared `DELETE` operation and confirmation
decision. Use `CrudDeleteAction` and `useCrudDeleteAction()` through the view
actions slot; do not rebuild their confirmation, request, invalidation, and
navigation flow.

## Strict temporal values

With `json-rest-schema` 1.0.17, temporal resource values are strings:

- `date`: `YYYY-MM-DD`
- `time`: offset-free `HH:MM[:SS[.fraction]]`
- `dateTime`: RFC 3339 with seconds and `Z` or a numeric offset

Convert JavaScript `Date` objects at the boundary, normally with
`toISOString()`. Numeric epochs use `epochMilliseconds` or `epochSeconds`.
Honor `temporalPrecision`; repositories return strict strings.

## Migration ownership

Migrations are immutable application source owned with their resource. Never make a live table or a generator the sole source of truth. Schema inspection is for adoption and diagnosis, not compulsory authoring.

Before sign-off, rebuild from zero in a fresh disposable database, compare the
schema, test ownership boundaries and failure cases, and run current-state
verification. Do not create a workboard entry, ownership receipt, generation
record, or historical proof that tooling ran.
