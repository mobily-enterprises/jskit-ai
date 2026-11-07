---
id: crud/crud-contract
title: Owner-scoped CRUD contract
summary: Define an application table resource whose records belong to the current user, and the authenticated CRUD contract that serves it.
keywords: authenticated, crud, database, owner-scoped, resource, table, user
requires: @jskit-ai/resource-core, @jskit-ai/resource-crud-core
---

# Owner-scoped CRUD contract

## Use when

Use this pattern when an authenticated application stores records that belong
to one user and standard list, view, create, patch, and delete behaviour fits
the product.

The example is intentionally a normal source file. Copy it directly when the
shape fits, adapt its fields and language for another entity, or read it as a
reference for `defineTableResource()` and `defineCrudContract()`.

## Do not use when

Do not use this pattern for public records, workspace-owned records, inherited
ownership, composite identities, or a domain whose operations do not match
normal CRUD behaviour. Select a pattern matching the real ownership and
operation model instead of changing `ownership` merely to make a test pass.

## Product decisions

Know these decisions before adapting the example:

- whether records truly belong to the current user
- which fields are required, optional, nullable, searchable, or hidden
- whether a value is free text or a constrained vocabulary
- which operations the product actually exposes
- the user-facing success and failure language

Those decisions come from the product conversation or existing application,
not from a JSKIT questionnaire.

## Invariants

- The persisted table has a normal single-column primary key.
- User ownership is represented by a non-null `user_id` column.
- The resource's hidden `userId` field maps to that ownership column.
- `ownership: "user"` is used only for genuine current-user ownership.
- The table has exactly one table resource; the CRUD contract is built on it.
- Each product field's output, create, and patch participation is its entry
  in the CRUD contract's `fields`, or the default `defineCrudContract()` gives
  a field without one (see Field operations and lookups below).
- Temporal database values use the declared storage serializer.
- The source-controlled migration and resource contract agree.
- Server policy tests prove that one user cannot read or mutate another user's
  records.

## Framework APIs

The example uses `defineTableResource()` from
`@jskit-ai/resource-core/shared/tableResource` for the table's facts (name,
table, ownership, fields, search and sort) and `defineCrudContract()` from
`@jskit-ai/resource-crud-core/shared/crudContract` for its HTTP surface
(its required `namespace`, operations, access, field operations and messages). The CRUD contract derives
the normal CRUD operation validators from the table resource's fields.

Higher layers should consume this resource through JSKIT's CRUD service,
repository, route, and UI APIs. They should not rebuild field validators or
serialize requests independently.

## Field operations and lookups

The CRUD contract's `fields` name, for each field, the operations it takes part
in: `output` (the record in every response), and `create` and `patch` (the
request bodies; an enabled `replace` uses the `create` fields unless a field
names `replace`). Each takes `"required"`, `"optional"` or an object. A field
that has no entry takes the default:

| Field | Default operations |
| --- | --- |
| `primary: true` | `{}`: no operation; every record output already carries its `id` |
| `hidden: true` | `{}`: no operation |
| `readOnly: true` | `{ output: { required: true } }` |
| `createdAt` or `updatedAt` stored as a `dateTime` | `{ output: { required: true } }`: the handle stamps them |
| any other field | `{ output: { required: true }, create: { required: <the field's required> }, patch: { required: false } }` |

So a `required: true` field is required on create, and any other field is
optional there. An entry you write always wins, for example
`notes: { output: "optional", create: "optional", patch: "optional" }` for a
field that is optional everywhere. Write an entry only where it differs from
the default.

A stored `createdAt` or `updatedAt` is output only, and a contract that lets a
request write one (a `create`, `patch` or `replace` entry, or an explicit body
that takes it) is refused: the handle stamps `createdAt` on a create and
`updatedAt` on every write, replacing what a request sends. Only a system
context, as an import uses, sets its own.

A lookup field (`lookup: "<namespace>"`) is the table resource's: the
`database/table-resource` pattern lists what it expands to.

## Example files

- `example/bookResource.js` is a complete table resource (`bookResource`) and
  CRUD contract (`bookCrud`) for personal book records.

The example deliberately uses a concrete domain. Rename and edit normal source
rather than feeding it through placeholder interpolation.

## Variation points

Safe adaptations include:

- resource name, table name and CRUD namespace
- product fields and validation
- searchable fields and default sort
- enabled CRUD operations
- user-facing messages
- lookup relationships supported by the resource APIs

Changing ownership, access, identity, or persistence architecture selects a
different pattern and requires corresponding policy and migration evidence.

## Verification

- Import the CRUD contract and prove all intended operations exist.
- Validate representative accepted and rejected field values.
- Rebuild the table from source-controlled migrations in a disposable database.
- Run positive current-user CRUD tests.
- Run negative cross-user read and mutation tests.
- Run the application's focused tests and broad verifier at sign-off.

## Avoid

- generator provenance or scaffold-shape metadata
- a field-by-field questionnaire
- a live table as the only source of schema truth
- app-specific request serializers that duplicate the CRUD contract
- a second table resource for the same table
- hidden ownership aliases other than the framework's explicit ownership field
- durable receipts recording that this pattern was copied
- changing an installed baseline migration instead of adding a new migration
