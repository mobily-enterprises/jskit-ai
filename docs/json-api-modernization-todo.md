# JSON:API Consistency TODO

Status: active

Last updated: 2026-05-01

## Purpose

This file defines the remaining work needed to make the codebase internally and externally consistent around JSON:API.

The first migration pass is already done:

- direct CRUD packages such as `contacts` and `exampleapp/users` now use the native JSON:API host path
- `users-core` and `workspaces-core` repositories no longer use the old simplified-host style
- actions now stay thin and no longer duplicate output validation where routes already validate the HTTP response

What is still missing is the second pass:

- a single explicit rule for when success payloads are JSON:API on the wire
- a single explicit rule for how lower layers propagate "already a JSON:API document" upward
- a single naming rule for repository/service methods that return JSON:API documents vs plain/domain data
- a route/runtime contract that does not require upper layers to guess whether a payload is already wrapped

This document is the target architecture and the implementation checklist.

---

## Final decisions

These are the rules we are implementing. They are not open questions anymore.

### 1. JSON:API wire contract

For any endpoint classified as a JSON:API endpoint:

- `204 No Content` means success with no body
- any other successful `2xx` response with a body must return a JSON:API document

That document may contain:

- `data`
- or only `meta`

This means:

- record fetch/update/create responses return `data`
- collection responses return `data`
- command success messages can return top-level `meta`
- pure side-effect success with no useful payload can return `204`

### 2. Not every endpoint in the whole system must be JSON:API

The following endpoint classes may stay non-JSON:API:

- binary downloads
- multipart uploads
- redirects
- transport/bootstrap/session utility endpoints where no application data document is being returned

Everything else that is a data endpoint should be treated as a JSON:API candidate and audited accordingly.

### 3. JSON:API-ness is a call-level contract, not a repository-level identity

We are not saying "this repository always returns JSON:API" or "this repository never returns JSON:API".

We are saying each method has an explicit contract.

### 4. Naming rule for methods

Use plain names for plain/domain results:

- `findById`
- `findByUserId`
- `ensureForUserId`
- `listForWorkspace`
- `updateDisplayNameById`

Use `Document` for a single JSON:API document result:

- `getDocumentById`
- `createDocument`
- `patchDocumentById`
- `deleteDocumentById`

Use `Documents` for collection JSON:API document results:

- `queryDocuments`

Do not hide return shape behind option flags such as:

```js
findById(id, { as: "document" })
```

The method name must reveal the return shape.

### 5. Lower layers must explicitly signal whether the result is already wrapped

Routes should not guess based on payload shape and should not rely on local tribal knowledge.

The runtime contract should distinguish between:

- already a JSON:API document
- plain/domain data that still needs wrapping

### 6. Actions stay thin

Actions continue to:

- validate normalized input
- avoid validating output for route-owned HTTP flows
- return whatever the service explicitly returns

Actions must not inspect payload shape to guess whether it is JSON:API.

---

## Target runtime contract

This is the runtime behavior we want after the remaining implementation work is done.

### JSON:API route success handling

For a JSON:API route, the action/service result must be one of:

1. an explicit "document" result
2. an explicit "data" result
3. `undefined`/`null` only when the route is returning `204`

Any other result shape should be treated as a contract error.

### Recommended helpers

Add explicit helpers for success results, for example:

```js
returnJsonApiDocument(document)
returnJsonApiData(data)
```

Semantics:

- `returnJsonApiDocument(...)`
  - signals the payload is already a JSON:API document
  - route transport must send it as-is

- `returnJsonApiData(...)`
  - signals the payload is plain/domain data
  - route transport must wrap it into a JSON:API document

### Route transport behavior

For JSON:API routes:

- if result kind is `document` -> passthrough
- if result kind is `data` -> wrap into JSON:API
- if status is `204` -> no body
- otherwise -> throw contract error

This removes guesswork from the route layer.

### Service behavior

Services must not guess or re-wrap either.

Service methods should:

- return plain/domain data for aggregate/domain flows
- return explicit document results for direct resource passthrough flows

### Repository behavior

Repository methods returning documents should use native host JSON:API where possible.

Repository methods returning plain/domain data may still use the internal host natively, but should simplify/normalize before returning.

What we do not want:

- `simplified: true` + manual re-wrapping into fake JSON:API

That is lossy and pushes transport shaping into the wrong layer.

---

## Codebase-wide implementation plan

The work below is intentionally specific. Each item should be completed or explicitly rejected.

## Phase 1: add explicit JSON:API success result wrappers

### 1.1 Add shared helpers

Add shared helpers in a stable runtime location.

Recommended home:

- `packages/http-runtime/src/shared/...`
  - if the concern is transport/result semantics

or

- `packages/kernel/shared/...`
  - if the concern is generic route/action result tagging

Choose one home and keep it central.

Helpers to add:

- `returnJsonApiDocument(document)`
- `returnJsonApiData(data)`
- `isJsonApiDocumentResult(value)`
- `isJsonApiDataResult(value)`

Requirements:

- wrapper shape must be explicit and stable
- no inference from arbitrary payload shape
- no transport-specific mutation at call sites

### 1.2 Update JSON:API route transport

Files to update:

- `packages/http-runtime/src/shared/validators/jsonApiRouteTransport.js`
- `packages/kernel/server/http/lib/routeRegistration.js`
- possibly `packages/kernel/server/http/lib/routeTransport.js`

Tasks:

- teach JSON:API route transport to understand tagged result wrappers
- preserve `204` handling
- reject untagged success payloads for JSON:API routes once the migration is complete
- during transition, optionally allow compatibility mode behind a narrow internal switch only if absolutely necessary

Preferred end state:

- no compatibility mode
- JSON:API routes require explicit result contracts

### 1.3 Add tests for explicit result handling

Add or update tests in:

- `packages/http-runtime/test/...`
- `packages/kernel/server/http/lib/...test.js`

Must cover:

- tagged document passthrough
- tagged plain-data wrapping
- `204` with no body
- contract error for untagged payload on JSON:API route

---

## Phase 2: align repository and service naming

### 2.1 Establish naming rule in docs and tests

Add explicit conventions to docs/reference/tests:

- plain/domain methods use plain names
- JSON:API document methods use `Document`
- JSON:API collection document methods use `Documents`

### 2.2 Audit all repository methods

Audit:

- `exampleapp/packages/contacts/src/server/repository.js`
- `exampleapp/packages/users/src/server/repository.js`
- `packages/users-core/src/server/common/repositories/*.js`
- `packages/workspaces-core/src/server/common/repositories/*.js`
- `packages/workspaces-core/src/server/workspaceSettings/workspaceSettingsRepository.js`

For each method:

- identify current return shape
- rename if necessary to reflect actual return shape
- split polymorphic methods into explicit methods if needed

Examples of expected outcomes:

- `findByUserId(...)` stays plain
- `queryDocuments(...)` returns JSON:API collection document
- `getDocumentById(...)` returns JSON:API record document

### 2.3 Audit all service methods

Audit:

- direct CRUD services in `exampleapp`
- `users-core` account services
- `workspaces-core` domain services

For each service method:

- mark whether it is direct document passthrough or aggregate/domain composition
- ensure the returned result kind matches that role

Rules:

- direct resource flows should usually return `returnJsonApiDocument(...)`
- aggregate/domain flows should usually return `returnJsonApiData(...)`

---

## Phase 3: classify endpoints by transport policy

Every endpoint must be assigned to one of these classes.

### 3.1 Class A: JSON:API data endpoint

Rules:

- successful body is always JSON:API
- `204` allowed for no-body success
- response validation handled by Fastify JSON:API route schemas

Candidates already in this class:

- `exampleapp/packages/contacts/src/server/registerRoutes.js`
- `exampleapp/packages/users/src/server/registerRoutes.js`
- account settings/profile/preferences/notifications routes in `users-core`

### 3.2 Class B: transport-special endpoint

Rules:

- may remain non-JSON:API
- must be documented as such

Examples:

- avatar binary read
- avatar multipart upload
- OAuth redirect start
- explicit no-body utility routes

### 3.3 Class C: data endpoints still plain JSON today and needing a policy decision

These must be audited one by one and either:

- migrated to JSON:API wire format
- or explicitly documented as permanent exceptions

Current candidates:

- `packages/workspaces-core/src/server/workspaceDirectory/bootWorkspaceDirectoryRoutes.js`
- `packages/workspaces-core/src/server/workspaceMembers/bootWorkspaceMembers.js`
- `packages/workspaces-core/src/server/workspaceSettings/bootWorkspaceSettings.js`
- `packages/workspaces-core/src/server/workspacePendingInvitations/bootWorkspacePendingInvitations.js`
- possibly `packages/users-core/src/server/accountSecurity/bootAccountSecurityRoutes.js`

Decision rule:

- if the route returns application data, default toward JSON:API
- if the route is effectively RPC/utility and returning no meaningful data, allow plain `204` or documented exception

---

## Phase 4: migrate route families to the explicit JSON:API contract

### 4.1 Direct resource route families

Targets:

- `contacts`
- `exampleapp/users`
- any future CRUD generator outputs

End state:

- repository/service paths return `returnJsonApiDocument(...)`
- routes no longer rely on app-code `wrapResponse: false` as implicit tribal knowledge
- route transport sees explicit document result and passes through

### 4.2 Aggregate JSON:API route families

Targets:

- `/api/settings`
- `/api/settings/profile`
- `/api/settings/preferences`
- `/api/settings/notifications`

End state:

- service returns `returnJsonApiData(...)`
- route transport wraps consistently
- HTTP wire format remains JSON:API

### 4.3 Remaining plain JSON data routes

Targets:

- workspace directory/settings/members/invites/pending-invitations
- other route families discovered during audit

For each route family:

1. decide whether it is a JSON:API data endpoint
2. if yes:
   - switch route contract to JSON:API
   - decide per action/service whether it returns `document` or `data`
3. if no:
   - document it as a transport-special exception

---

## Phase 5: generator alignment

The generators must produce the final architecture by default.

### 5.1 CRUD server generator

Files to audit/update:

- `packages/crud-server-generator/templates/src/local-package/server/repository.js`
- `packages/crud-server-generator/templates/src/local-package/server/service.js`
- `packages/crud-server-generator/templates/src/local-package/server/actions.js`
- `packages/crud-server-generator/templates/src/local-package/server/registerRoutes.js`
- related tests under `packages/crud-server-generator/test`

Requirements:

- repository methods named by return shape
- service methods return explicit tagged result wrappers
- routes use JSON:API contracts with explicit result handling
- no repeated repository-local transport helpers

### 5.2 Users/workspace scaffolds

Files to audit/update:

- `packages/users-core/templates/...`
- any workspace/package scaffolds that still emit old assumptions

Requirements:

- no simplified-host style
- no hidden wrapper assumptions
- no route-local guesswork about wrapped vs unwrapped success payloads

---

## Phase 6: documentation and client contract

### 6.1 Add architectural documentation

Add or update docs explaining:

- JSON:API endpoint rule
- `204` rule
- `meta`-only success document rule
- repository/service/action naming rules
- explicit document/data result wrappers

### 6.2 Add client-consumption documentation

Document the client rule clearly:

```js
if (response.status === 204) {
  return null;
}
return decodeJsonApi(body);
```

Also document:

- plain JSON exceptions
- binary/multipart/redirect exceptions

### 6.3 Add reviewer checklist

Add a short checklist for future PRs:

- Does this endpoint return data?
- If yes, is it JSON:API on the wire?
- If no, is it a documented exception?
- Does the method name reveal whether it returns plain data or a document?
- Is result wrapping explicit?

---

## Phase 7: verification

The migration is not complete until these checks exist and pass.

### 7.1 Automated tests

Required coverage:

- JSON:API route with plain-data result wraps correctly
- JSON:API route with document result passes through correctly
- `204` route returns no body and is not decoded
- plain JSON exception routes still behave as documented
- repository method naming tests where scaffolds are generated

### 7.2 End-to-end browser/API checks

At minimum:

- account surface
- admin surface
- direct CRUD resource routes
- aggregate settings routes
- migrated workspace routes

### 7.3 Grep-based enforcement

Add targeted grep checks where appropriate for:

- no new `simplified: true`
- no new `createSimplifiedWriteParams(...)`
- no new shape-switching method flags like `{ as: "document" }`

---

## Concrete audit checklist

Use this checklist package by package.

### `exampleapp/packages/contacts`

- [ ] verify repository method names reflect document vs plain return shape
- [ ] change service returns to explicit document/data wrappers
- [ ] remove route-local implicit passthrough assumptions if still present
- [ ] update tests

### `exampleapp/packages/users`

- [ ] same audit as `contacts`

### `packages/users-core`

- [ ] audit all account settings/profile/preferences/notifications flows
- [ ] classify each route as JSON:API data vs transport-special
- [ ] keep aggregate services plain internally where appropriate
- [ ] return explicit document/data wrappers
- [ ] decide whether account security routes should remain non-JSON:API or migrate

### `packages/workspaces-core`

- [ ] classify workspace directory routes
- [ ] classify workspace settings routes
- [ ] classify workspace members/invites routes
- [ ] classify pending invitations routes
- [ ] migrate data endpoints to JSON:API wire format or document them as exceptions

### `packages/json-rest-api-core`

- [ ] keep host/runtime helpers focused on native host integration
- [ ] do not turn this package into an ad hoc wrapper junk drawer
- [ ] only keep helpers here that genuinely belong to host integration

### `packages/http-runtime`

- [ ] own the JSON:API transport/result-tagging behavior
- [ ] enforce explicit success result contracts

### `packages/kernel`

- [ ] own any generic action/route result tagging primitives if they are not HTTP-specific

---

## End-state acceptance criteria

This work is complete only when all of the following are true:

1. For JSON:API endpoints, every successful response with a body is a JSON:API document.
2. `204` is the only successful no-body response path.
3. Lower layers explicitly signal whether a result is already a JSON:API document or plain data.
4. Routes do not guess based on payload shape.
5. Repository/service method names reveal return shape.
6. No new simplified-host style code exists.
7. The remaining non-JSON:API routes are deliberate, documented exceptions.
8. Generators emit the final architecture by default.

---

## Explicit non-goals

This migration does not require:

- forcing binary, multipart, or redirect flows into JSON:API
- making every repository method in the codebase return JSON:API
- keeping compatibility shims forever
- preserving ambiguous naming where return shape is hidden
