# JSON:API CRUD Service Contract

Status: active

Last updated: 2026-05-01

## Purpose

This file is the explicit contract for the generated JSON:API CRUD service shape used by:

- `packages/crud-server-generator`
- `packages/users-core` users package templates
- app-local generated CRUD services that follow the same contract

This contract is narrower than the broader architecture notes in `docs/json-api-modernization-todo.md`.
It defines the exact generated service API, not the full migration plan.

## Factory contract

Generated services expose:

```js
createService({ <namespace>Repository } = {})
```

Requirements:

- the repository dependency is required
- if it is missing, `createService(...)` must throw:

```js
new TypeError("createService requires <namespace>Repository.")
```

The returned service object must be frozen.

## Vocabulary rule

For this service layer:

- methods returning JSON:API documents use `Document` / `Documents`
- helpers and error semantics should also talk in documents
- `recordId` remains the input identifier name for direct lookup/update/delete calls

That means the service contract is document-oriented even though the identifier parameter remains `recordId`.

## Shared success-result rule

These service methods do not return raw JSON:API documents directly.
They return the shared tagged success shape from `@jskit-ai/http-runtime/shared`:

- `returnJsonApiDocument(document)`

That produces:

```js
{
  __jskitJsonApiResult: true,
  kind: "document",
  value: <jsonApiDocument>
}
```

JSON:API routes then pass that tagged document result through unchanged.

## Method contract

### `queryDocuments(query = {}, options = {})`

Purpose:

- fetch a JSON:API collection document

Repository call:

```js
repository.queryDocuments(query, {
  trx: options?.trx || null,
  context: options?.context || null
})
```

Forwarded options:

- `trx`
- `context`

Not forwarded specially:

- `include` is not forwarded as a top-level option here; if needed it travels inside `query`

Return:

```js
returnJsonApiDocument(<collectionDocument>)
```

### `getDocumentById(recordId, options = {})`

Purpose:

- fetch a single JSON:API record document

Repository call:

```js
repository.getDocumentById(recordId, {
  trx: options?.trx || null,
  context: options?.context || null,
  include: options?.include
})
```

Forwarded options:

- `trx`
- `context`
- `include`

Return on success:

```js
returnJsonApiDocument(<recordDocument>)
```

404 rule:

- if the repository returns `null` / missing, the service must throw:

```js
new AppError(404, "Document not found.")
```

### `createDocument(payload = {}, options = {})`

Purpose:

- create a record and return a JSON:API record document

Repository call:

```js
repository.createDocument(payload, {
  trx: options?.trx || null,
  context: options?.context || null
})
```

Forwarded options:

- `trx`
- `context`

Return:

```js
returnJsonApiDocument(<recordDocument>)
```

### `patchDocumentById(recordId, payload = {}, options = {})`

Purpose:

- patch a record and return a JSON:API record document

Repository call:

```js
repository.patchDocumentById(recordId, payload, {
  trx: options?.trx || null,
  context: options?.context || null
})
```

Forwarded options:

- `trx`
- `context`

Return on success:

```js
returnJsonApiDocument(<recordDocument>)
```

404 rule:

- if the repository returns `null` / missing, the service must throw:

```js
new AppError(404, "Document not found.")
```

### `deleteDocumentById(recordId, options = {})`

Purpose:

- delete a record for a route that will normally return `204`

Repository call:

```js
repository.deleteDocumentById(recordId, {
  trx: options?.trx || null,
  context: options?.context || null
})
```

Forwarded options:

- `trx`
- `context`

Return:

- the repository result is returned unchanged
- the standard generated CRUD repository returns `null` here
- generated JSON:API delete routes pair this with `204 No Content`

This method does not wrap the result in `returnJsonApiDocument(...)`.

## Local helper contract

Generated services may use a local helper to enforce the 404 rule.
The stable generated helper name is:

```js
function return404IfNotFound(document = null) {
  if (!document) {
    throw new AppError(404, "Document not found.");
  }
  return document;
}
```

## What this layer does not do

Generated JSON:API CRUD services do not:

- inspect payload shape to guess whether something is JSON:API
- wrap plain data into JSON:API `data` results
- emit `meta` results
- validate action output schemas
- hide return shape behind option flags

Those concerns belong elsewhere:

- repository determines whether it returns documents
- services explicitly tag document results
- route transport decides final passthrough vs wrapping behavior

## Required matching tests

At minimum, contract tests must assert:

- missing repository dependency throws immediately
- exact exported method names are present
- each method forwards the correct options
- `getDocumentById(...)` and `patchDocumentById(...)` throw `404` with `"Document not found."` when the repository returns missing
- document-returning methods return tagged `kind: "document"` results
- `deleteDocumentById(...)` returns the repository result unchanged
