# JSON:API Modernization Closeout

Status: complete

Last updated: 2026-05-05

## Purpose

This file is the final closeout record for the JSON:API modernization work.

The old migration todo is retired. The repository now has one consistent rule set for JSON:API route behavior, explicit success result tagging, and the remaining intentional non-JSON:API exceptions.

## Final rules

### 1. JSON:API endpoints use explicit route contracts

JSON:API routes use `createJsonApiResourceRouteContract(...)`.

That contract owns:

- request body wrapping and unwrapping
- response document wrapping
- collection vs record semantics
- JSON:API error document shaping

Routes do not rely on local `wrapResponse: false` knowledge.

### 2. JSON:API success results are explicit

JSON:API routes accept only explicit tagged success results:

- `returnJsonApiDocument(...)`
- `returnJsonApiData(...)`
- `returnJsonApiMeta(...)`

The route transport decides what to do from the tag, not by guessing payload shape.

### 3. `204` is the only successful no-body path

For JSON:API routes:

- `204` means success with no body
- any other successful response with a body returns a JSON:API document

### 4. Method names reveal return shape

Plain/domain methods use plain names:

- `findById`
- `findByEmail`
- `listForUserId`
- `updateSettingsByWorkspaceId`

JSON:API document methods use explicit document names:

- `queryDocuments`
- `getDocumentById`
- `createDocument`
- `patchDocumentById`
- `deleteDocumentById`

No shape-switch flags are used to hide return shape behind one method name.

### 5. Host-side manual JSON:API flattening is removed

Domain repositories no longer call a shared `simplifyJsonApiDocument(...)` helper from `json-rest-api-core`.

If a repository wants plain/domain data, it consumes the host's native simplified result directly.

If a repository wants a full JSON:API document, it explicitly requests and returns that document.

### 6. `simplified: false` is now intentional and narrow

The remaining `simplified: false` usage is in generated CRUD document repositories and templates.

That is not legacy.

It is the correct path when a repository method is explicitly a `Document` / `Documents` method and must return a full JSON:API document for upper layers to pass through with `returnJsonApiDocument(...)`.

What is gone is the old mixed pattern:

- force `simplified: false`
- manually flatten the document in app code
- then rebuild a fake JSON:API shape later

## Completed work

### Core transport and wrappers

Completed:

- explicit tagged success wrappers exist in `packages/http-runtime/src/shared/validators/jsonApiResult.js`
- JSON:API route transport enforces tagged success results in `packages/http-runtime/src/shared/validators/jsonApiRouteTransport.js`
- untagged JSON:API success payloads are rejected

### CRUD and scaffold alignment

Completed:

- generated CRUD repositories use explicit `Document` / `Documents` methods
- generated CRUD services return `returnJsonApiDocument(...)`
- example generated packages already follow the final contract

### `console-core`

Completed:

- `/api/console/settings` read and update routes now use JSON:API route contracts
- console settings actions now return tagged JSON:API data results

Files:

- `packages/console-core/src/server/consoleSettings/bootConsoleSettingsRoutes.js`
- `packages/console-core/src/server/consoleSettings/consoleSettingsActions.js`

### `assistant-runtime`

Completed:

- assistant settings read/update routes now use JSON:API route contracts
- assistant conversations list route now uses JSON:API collection transport
- assistant conversation messages route now uses JSON:API record transport
- assistant actions now return tagged JSON:API data results
- assistant client requests now send JSON:API transport metadata so client decode stays consistent

Files:

- `packages/assistant-runtime/src/server/registerRoutes.js`
- `packages/assistant-runtime/src/server/actions.js`
- `packages/assistant-core/src/client/lib/assistantApi.js`
- `packages/assistant-core/src/shared/jsonApiTransports.js`

### `users-core` and `workspaces-core` repository cleanup

Completed:

- plain/domain repositories no longer manually flatten JSON:API documents
- repository tests now verify the host's native simplified result shape instead of the deleted manual path

Files:

- `packages/users-core/src/server/common/repositories/userProfilesRepository.js`
- `packages/users-core/src/server/common/repositories/userSettingsRepository.js`
- `packages/workspaces-core/src/server/common/repositories/workspacesRepository.js`
- `packages/workspaces-core/src/server/common/repositories/workspaceInvitesRepository.js`
- `packages/workspaces-core/src/server/common/repositories/workspaceMembershipsRepository.js`
- `packages/workspaces-core/src/server/workspaceSettings/workspaceSettingsRepository.js`

### Deleted legacy host helper

Completed:

- `packages/json-rest-api-core/src/server/jsonRestApiHost.js` no longer exports a host-side `simplifyJsonApiDocument(...)`
- the boundary test was updated to match the smaller supported host API

## Intentional non-JSON:API exceptions

These remain correct and are not part of the migration:

- binary downloads
- multipart uploads
- redirects
- NDJSON assistant chat stream responses

Current examples:

- account avatar binary read
- account avatar multipart upload
- OAuth provider redirect start
- assistant chat stream

## Verification

Focused verification run after the final changes:

```bash
node --test \
  packages/assistant-core/test/assistantApiSurfaceHeader.test.js \
  packages/assistant-core/test/assistantResource.test.js \
  packages/assistant-runtime/test/actionDefinitions.test.js \
  packages/assistant-runtime/test/lazyAppConfig.test.js \
  packages/assistant-runtime/test/repositoryContracts.test.js

node --test \
  packages/console-core/test/consoleRouteRequestInputValidator.test.js \
  packages/console-core/test/consoleSettingsService.test.js \
  packages/console-core/test/repositoryContracts.test.js \
  packages/users-core/test/repositoryContracts.test.js \
  packages/workspaces-core/test/repositoryContracts.test.js \
  packages/workspaces-core/test/workspacesRepository.test.js \
  packages/workspaces-core/test/workspaceInvitesRepository.test.js \
  packages/workspaces-core/test/workspaceMembershipsRepository.test.js \
  packages/workspaces-core/test/workspaceSettingsRepository.test.js \
  packages/json-rest-api-core/test/entrypoints.boundary.test.js
```

Repository sweep checks performed:

- no remaining `simplifyJsonApiDocument` usage in `users-core`, `workspaces-core`, or `json-rest-api-core`
- no remaining plain assistant settings / conversations / conversation-messages route contracts
- no remaining plain console settings route contracts

## Closeout checklist

- [x] tagged JSON:API success wrappers enforced at the route boundary
- [x] CRUD generator and scaffold output aligned with `Document` / `Documents` naming
- [x] `console-core` settings routes aligned
- [x] `assistant-runtime` settings and transcript routes aligned
- [x] host-side manual JSON:API simplification removed from domain repositories
- [x] legacy host simplification export removed
- [x] focused tests updated and passing

## What remains open

Nothing for this migration.

Future work may add new JSON:API endpoints, but they should follow the rules above rather than reopening this migration.
