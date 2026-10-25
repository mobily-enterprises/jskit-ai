# CRUD authoring

Use this file for normal persisted entities, resource contracts, migrations,
JSON API routes, and matching screens.

## Start from product decisions

Establish the entity, fields, relationships, ownership, access surface,
operations, search, sorting, and destructive behavior. Ask when a material
choice is missing. Do not turn these decisions into generator options.

Read these package-owned source patterns:

- `crud/resource-contract` for the shared field and ownership contract
- `crud/json-api-resource-package` for migration and server composition
- `crud/crud-screen-set` for routed list, view, create, edit, and delete UI

## Normal implementation order

1. Author a source-controlled migration in the package that owns the entity.
2. Define the resource with `defineCrudResource()`.
3. Bind standard server behavior with `defineCrudJsonApiFeature()`.
4. Add only product-specific service methods, lifecycle, actions, validation,
   policy, queries, messages, and orchestration.
5. Declare the package provider and framework capabilities in `package.json`.
6. Build thin route pages over JSKIT's shared CRUD screen APIs.
7. Install the coherent package graph once.
8. Rebuild a disposable database and run focused server, client, and browser
   verification.

The migration and resource are both authored contracts. A live schema is useful
for understanding an imported system, but it is never the sole source of truth.

## Ownership and access

- `public` means every record is intentionally public. It cannot be combined
  with user or workspace ownership.
- `user` requires a real user ownership column and negative cross-user tests.
- `workspace` and `workspace_user` require an explicit workspace route/action
  scope plus named permission policy.
- Domain relationships such as `recipient_user_id` are not ownership merely
  because they point to a user.

Normal CRUD tables use one non-null single-column primary key. Foreign keys are
single-column and target compatible keys. Composite unique indexes may enforce
business rules but do not become framework identities.

## Schema evolution

An unapplied migration may be edited normally. Once applied or released, add a
new immutable migration for the next change. Keep resource fields and storage
metadata aligned with the resulting schema. Do not use a field-patching command
or rewrite a historical baseline.

## Customize without copying CRUD

`defineCrudJsonApiFeature()` deliberately keeps application extension points:

- `decorateRepository` adds the few persistence operations unique to the
  resource.
- `decorateService` overrides standard methods or adds domain methods such as
  `confirm`, `publish`, `cancel`, or `sendReminder`.
- `operationLifecycle` wraps a standard operation with `before`, `execute`,
  `after`, and mutation-only `afterCommit` phases. Mutation phases before commit
  receive the same transaction and `execute` receives `standard(nextInput)`.
- `actions` exposes non-CRUD service methods through normal validated,
  permissioned, audited JSKIT actions and optional explicit HTTP routes.

Keep database reads and writes in repositories. Services and lifecycle hooks
orchestrate repositories; they do not issue raw database queries. Put external
side effects after commit, or write a durable outbox record inside the
transaction when delivery must be reliable.

## When the resource abstraction does not fit

Use a separate explicit Feature for a different domain, aggregate, import job,
or command-oriented workflow that merely happens to mention the resource. A
CRUD resource may have many custom operations; it stops fitting only when CRUD
is no longer its principal public contract.

## Verification

- rebuild from zero in a fresh disposable database
- validate accepted and rejected values at the resource boundary
- test list/view/create/update/delete document shapes
- test positive owner access and negative cross-owner access
- test relationships and deletion behavior
- verify skeletons, stable pending labels, toast mutation feedback, and no
  horizontal overflow in compact, medium, and expanded screens
- run current framework and application verification

Avoid generator provenance, scaffold shapes, ownership receipts, workboards,
operation ledgers, hidden file markers, live-table-only schemas, and duplicated
route/request validators.
