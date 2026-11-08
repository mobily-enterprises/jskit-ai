# Changelog

## Unreleased

- A record a form saves back through the CRUD service as the service showed it keeps its link to a target the writer cannot see (json-rest-api 3.0.0): the `null` the read showed counts as unchanged.
- An included record shows the contract its relation names with `relation.namespace`, for a collection or a plain belongs-to as already for a lookup, so a narrower second contract on a table no longer shrinks the includes of every feature that names its own; an include that names none still shows the fields its table's contracts all show. `crud.contracts` refuses two different contracts under one namespace, saying so, and registers a contract served on several surfaces once.
- **Breaking (security).** The CRUD service answers records with only the attributes the CRUD contract's output names, on list, view, create and patch, where it answered every column json-rest-api returned whatever the contract said. The actions, routes and a `decorateService` built on the default service answer the same; server code calling the repository still gets whole records. An `include`d record shows only the output fields of its own table's CRUD contract (a lookup that declares its `labelKey` only that label; when several contracts serve its table, the fields they all show), a record of a table no contract serves shows only its id, a relationship the contract does not name is left out, and an included record only that relationship reaches is not answered. The served contracts come from `crud.contracts`, a registry crud-core's new `CrudContractsProvider` provides: each CRUD feature registers its contract during setup, the registry is sealed at boot, and each service reads it once. The internal `createCrudService` takes `{ repository, crud, contracts }` in place of `{ repository, resourceName }`. **Upgrading:** a package with a CRUD feature lists `crud.contracts` in its descriptor's `capabilities.requires`; a test runtime that starts CRUD features adds `CrudContractsProvider` (`@jskit-ai/crud-core/server/crudContracts`).
- The CRUD service no longer stamps `createdAt` and `updatedAt` itself, and `createCrudService` no longer takes `schema`: the handle stamps them on every write. A request cannot set them: a create body's `createdAt` or a patch body's `updatedAt` gives way to the server's time (the CRUD contract no longer takes them either).
- **Breaking.** `defineCrudFeature` fails at once on code written for the earlier CRUD API, naming the replacement, instead of ignoring it. It refuses an option it does not take (`ownershipFilter` is now `visibility`; `searchSchema`, `rowPolicy`, `queryFields` and `hooks` go in an `owns` entry; `resource` is now `crud`), a permission for an action the feature does not define (`patch` is the `update` action) or under any but the lower-case name it is read by, a decorated repository or service that still defines a method of the earlier API (such as `queryDocuments()` or `updateRecord()`), and a decorated service without its own method for an enabled operation. Reading `database`, `http`, `jsonRestApi` or `resource` from `decorateRepository`'s dependencies, `resource` from `decorateService`'s or from the feature's capability, or `trx` in a lifecycle hook throws, naming what replaced it (`repository` and `resources`, `crud`, `options`); spreading those objects leaves the names out. The CRUD service's `view()` refuses `forUpdate`, naming `lock()` inside `withTransaction`.
- The CRUD service stamps `createdAt` and `updatedAt` on a create (unless the payload sets them) and `updatedAt` on a patch, when the table resource stores them as date-time fields, as the earlier CRUD runtime did.
- `createHooksToCollectChildren` reading through a child repository's `queryAll()` now says which "in" filter the child table must declare for its foreign key when the table refuses the list of owner ids, instead of passing on json-rest-api's validation error.
- **Breaking.** `@jskit-ai/crud-core/server/fieldAccess` and `@jskit-ai/crud-core/server/lookups`, which nothing called since the CRUD runtime was removed, are gone, with the `crud.fieldAccess.writeDenied` message and the `CrudFieldAccess` and `CrudLookupRepository` types.

- **Breaking (data-access redesign).** `defineCrudJsonApiFeature({ resource })` takes a CRUD contract from `@jskit-ai/resource-crud-core`'s `defineCrudContract` and throws for anything else. It registers the contract's table resource under its `name`, filters by its `ownership` unless `ownershipFilter` says otherwise, and builds the repository with the table resource. `createCrudJsonApiRepository({ api, resource, resourceScopeName })` takes the table resource. List validators read `defaultSort` from the table resource.
- Depends on json-rest-api 2.4.0 (from 2.1.0); see `@jskit-ai/json-rest-api-core`'s CHANGELOG for what it changes.
- A CRUD JSON:API repository's `createDocument` and `patchDocumentById` take `returning: "full"` (the default, unchanged), `"minimal"` (`{ data: { type, id } }`) or `"none"`, so server code that ignores the result skips the read-back: a get through the row policy and lookups, about four queries per written record. `createDocuments(payloads, { trx, context, returning })` creates several records in order in one transaction, all or none, returning `"minimal"` results unless asked for `"full"`.
- The actions of an `internal: true` or `routes: false` CRUD feature are left off the `automation` channel, so the assistant cannot call them, unless their permission names a permission (`require: "all"` or `"any"`), as workspace-scoped CRUD's defaults do. An additional action's own `channels` still decide for it.
- A CRUD JSON:API repository's `queryDocuments(query, options)` throws a `TypeError` naming `queryEveryDocument` when `query.limit` is above the resource's json-rest-api `queryMaxLimit` (100 unless the resource sets it), instead of silently answering only `queryMaxLimit` records. New `queryEveryDocument(query, options)` answers every record the query matches as one JSON:API document `{ data, included }` (each included record once), reading 1,000-record pages in id order in the caller's transaction; its query takes filters, `include` and `fields`, but no `limit`, `cursor` or `sort`. New `queryMaxLimit()` reports the cap. The HTTP and automation list action still caps a larger `limit` and answers one page, whose `meta.pagination` reports the page size, `hasMore` and the next cursor, as before. `@jskit-ai/json-rest-api-core`'s new `queryAllJsonRestCollectionDocument(resource, params, context)` is the every-row read behind it.
- A CRUD JSON:API repository's `getDocumentById(recordId, query, { trx, forUpdate: true })` locks the record's row in `trx` before reading it (`SELECT ... FOR UPDATE`; nothing on SQLite, which runs one transaction at a time), so a concurrent `forUpdate` read or write of it waits until the transaction ends. It used to ignore `forUpdate`. Without a transaction it throws a `TypeError`, as does a `forUpdate` that is not a boolean. The CRUD service's `getDocumentById` passes `forUpdate` through, and the service gains `queryEveryDocument`.

### Upgrading

- json-rest-api 2.4.0 (from 2.1.0): `addResource` now rejects a field type json-rest-schema cannot cast, naming the field (JSKIT's own resources use only castable types); and a write's relationship targets are locked FOR SHARE (LOCK IN SHARE MODE on MySQL), so a lifecycle hook that then updates a referenced parent row in the same transaction should lock that row first, with `getDocumentById(parentId, {}, { trx, forUpdate: true })`, or two such writers can deadlock on the lock upgrade.
- `getDocumentById(..., { forUpdate: true })` now locks: server code that already passes `forUpdate: true` inside its transaction gets the lock it asked for. A call that passes `forUpdate: true` without `trx` now throws; read inside `withTransaction`.
- Give an internal resource explicit `permissions` when the assistant should keep reading it for the users who hold them.
- Server code that calls a CRUD repository's or service's `queryDocuments` with a `limit` above 100 now throws. It already received only 100 records, so a read meant to return more was losing rows. Replace `queryDocuments({ ...filters, limit: N })` and any cursor loop around it with `queryEveryDocument({ ...filters }, options)`, sorting the records it returns in memory; a "too many rows" guard (`rows.length >= N`) then sees the true count. Who is affected:
  - Server code that asked for more than 100 records in a cursor loop around `queryDocuments`.
  - Server code that asked for more than 100 records in one `queryDocuments` call with no cursor: the records past the 100th were dropped, and a "too many rows" guard on that read never fired.
  - Client pages that ask the list routes for 200 or 250 rows are not: they keep working, since HTTP still caps them.

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".

### Upgrading

- A missing document or record now answers `crud.document.notFound` / `crud.record.notFound` instead of `APP_ERROR` (same English and status).

### New message keys (9)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.errors.INVALID_CURSOR`
- `jskit.crud.record.notFound`
- `jskit.crud.document.notFound`
- `jskit.crud.fieldAccess.writeDenied`
- `jskit.crud.query.includeInvalid`
- `jskit.crud.query.fieldsInvalid`
- `jskit.crud.query.fieldsByTypeInvalid`
- `jskit.crud.query.fieldsKeysInvalid`
- `jskit.crud.query.fieldsKeysInvalidWithAliases`

</details>

### Codes (9)

Error, field-error and message codes this package sends, with their English. Undotted codes kept their existing values and render from `jskit.errors.<code>`.

| Code | English |
| --- | --- |
| `INVALID_CURSOR` | Invalid cursor. |
| `crud.record.notFound` | Record not found. |
| `crud.document.notFound` | Document not found. |
| `crud.fieldAccess.writeDenied` | Write access denied for fields: {fields}. |
| `crud.query.includeInvalid` | include expects a comma-separated string such as "{example}". |
| `crud.query.fieldsInvalid` | fields expects an object such as {example}. |
| `crud.query.fieldsByTypeInvalid` | fields expects an object keyed by JSON:API resource type, such as {example}. |
| `crud.query.fieldsKeysInvalid` | fields keys must be JSON:API resource types. Allowed keys: {allowedTypes}. |
| `crud.query.fieldsKeysInvalidWithAliases` | fields keys must be JSON:API resource types. Allowed keys: {allowedTypes}. Relationship aliases are invalid keys; {aliasGuidance}. |
