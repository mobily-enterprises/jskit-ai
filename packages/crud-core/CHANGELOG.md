# Changelog

## Unreleased

- A CRUD JSON:API repository's `createDocument` and `patchDocumentById` take `returning: "full"` (the default, unchanged), `"minimal"` (`{ data: { type, id } }`) or `"none"`, so server code that ignores the result skips the read-back: a get through the row policy and lookups, about four queries per written record. `createDocuments(payloads, { trx, context, returning })` creates several records in order in one transaction, all or none, returning `"minimal"` results unless asked for `"full"`.
- The actions of an `internal: true` or `routes: false` CRUD feature are left off the `automation` channel, so the assistant cannot call them, unless their permission names a permission (`require: "all"` or `"any"`), as workspace-scoped CRUD's defaults do. An additional action's own `channels` still decide for it.
- A CRUD JSON:API repository's `queryDocuments(query, options)` throws a `TypeError` naming `queryEveryDocument` when `query.limit` is above the resource's json-rest-api `queryMaxLimit` (100 unless the resource sets it), instead of silently answering only `queryMaxLimit` records. New `queryEveryDocument(query, options)` answers every record the query matches as one JSON:API document `{ data, included }` (each included record once), reading 1,000-record pages in id order in the caller's transaction; its query takes filters, `include` and `fields`, but no `limit`, `cursor` or `sort`. New `queryMaxLimit()` reports the cap. The HTTP and automation list action still caps a larger `limit` and answers one page, whose `meta.pagination` reports the page size, `hasMore` and the next cursor, as before. `@jskit-ai/json-rest-api-core`'s new `queryAllJsonRestCollectionDocument(resource, params, context)` is the every-row read behind it.
- A CRUD JSON:API repository's `getDocumentById(recordId, query, { trx, forUpdate: true })` locks the record's row in `trx` before reading it (`SELECT ... FOR UPDATE`; nothing on SQLite, which runs one transaction at a time), so a concurrent `forUpdate` read or write of it waits until the transaction ends. It used to ignore `forUpdate`. Without a transaction it throws a `TypeError`, as does a `forUpdate` that is not a boolean. The CRUD service's `getDocumentById` passes `forUpdate` through, and the service gains `queryEveryDocument`.

### Upgrading

- `getDocumentById(..., { forUpdate: true })` now locks: beepollen's `packages/driers/src/server/drierOperationLifecycle.js` (service, inside its transaction) gets the lock it asked for. A call that passes `forUpdate: true` without `trx` now throws; read inside `withTransaction`.
- Give an internal resource explicit `permissions` when the assistant should keep reading it for the users who hold them.
- Server code that calls a CRUD repository's or service's `queryDocuments` with a `limit` above 100 now throws. It already received only 100 records, so a read meant to return more was losing rows. Replace `queryDocuments({ ...filters, limit: N })` and any cursor loop around it with `queryEveryDocument({ ...filters }, options)`, sorting the records it returns in memory; a "too many rows" guard (`rows.length >= N`) then sees the true count. Calls found in the applications' main branches (canonical clones of 1-5 Nov 2026):
  - beepollen: `packages/allowed-login-email-policy/src/server/accessRuntime.js` `listAllowedLoginEmailEntries` (limit 500, cursor loop); `packages/processing-lot-events/src/server/processingLotEventRepositoryExtensions.js` `listByProcessingLotId` (limit 500, no cursor: a lot's events past the 100th are dropped today).
  - compas-next, `packages/owners-work/src/server`: `tariffWorkflowService.js` `listAllRows` (`WORKFLOW_PAGE_LIMIT` 500, cursor loop); `ownersChecklistAiWorkflowService.js` `loadContext` (`CHECKLIST_LIMIT` 500: a checklist past 100 rows is edited from its first 100 and the too-large guard never fires); `unappointedRequestWorkflowService.js` (`INVOICE_GROUP_LIMIT` 500, the same guard); `ownersWorkAiContext.js` (`CONTEXT_COLLECTION_QUERY_LIMIT` 501, the invoice and transaction reads and their too-large guards).
  - dogandgroom: `packages/daycare-engine/src/server/serviceContext.js` `queryRecords` (limit 250, cursor loop).
  - whs2: any server `queryDocuments` with a `limit` above 100 that has not yet moved to its every-row helpers.
  - None in racing, vibe64, vibe64-online, daniela, mercbot or virtual-gp. Client pages that ask the list routes for 200 or 250 rows keep working: HTTP still caps them.

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
