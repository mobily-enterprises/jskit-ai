# JSKIT Resource Transport Migration Todo

## Goal

Adopt a strict transport split across JSKIT HTTP routes:

- **resource routes**: JSON:API on the wire
- **command routes**: command-shaped request/response
- **UI/runtime**: consume simplified plain objects after decoding JSON:API

Internal actions, services, repositories, and CRUD runtimes should remain plain and simplified. Only the HTTP boundary should speak JSON:API for resource routes.

## Root Cause

The current JSKIT stack is missing a resource transport layer at the HTTP boundary.

What exists:

- plain route schema compilation and input normalization:
  - `jskit-ai/packages/kernel/server/http/lib/routeValidator.js`
- internal request transform seam:
  - `jskit-ai/packages/kernel/server/http/lib/routeRegistration.js`
- plain client request/response handling:
  - `jskit-ai/packages/http-runtime/src/shared/clientRuntime/client.js`
- a narrow JSON:API response simplifier that is not wired into CRUD/forms:
  - `jskit-ai/packages/http-runtime/src/shared/validators/jsonApiResponses.js`

What is missing:

- no explicit route transport mode
- no JSON:API request envelope support for JSKIT resource routes
- no response transform seam for JSON:API resource responses
- no client-side resource transport encoder/decoder
- no JSON:API error contract for resource routes
- no JSON:API query-string contract for resource lists

That is why generated CRUD and built-in settings/member routes currently bypass `json-rest-api` transport semantics and speak plain action JSON over HTTP.

## Target Architecture

### Resource Routes

- request body/query over HTTP: JSON:API
- response over HTTP: JSON:API
- internal action input: plain simplified object
- internal action output: plain simplified object
- client/UI input: plain simplified object after decoding
- resource routes must use real JSON:API document semantics:
  - primary data in `data`
  - resource objects with `type`, `id`, `attributes`, and `relationships` where applicable
  - top-level and resource `links` where we decide they are part of the contract
  - `included` for compound documents
  - `meta` only for true non-resource sidecar metadata

### Command Routes

- request body/query over HTTP: command-shaped
- response over HTTP: command-shaped
- no fake resource envelope unless the route is honestly modeling a resource

### Mixed Command Payloads

If a command needs nested resource documents, the **top-level route remains a command**, but specific nested properties may be JSON:API documents.

## Non-Goals

- forcing JSON:API onto auth, streaming, multipart uploads, binary downloads, or arbitrary imperative workflows
- making services or repositories speak JSON:API internally
- adding a global Fastify rewrite layer that guesses route semantics

## Design Rules

1. **Transport kind must be explicit per route**
   - `command`
   - `jsonapi-resource`

2. **JSON:API type must be explicit**
   - do not infer public wire `type` from internal `namespace` alone
   - operation-level override is required for multi-shape resource files

3. **Internal code stays plain**
   - JSON:API is only for the HTTP boundary

4. **Commands stay commands**
   - no fake resource envelopes for non-resource routes

5. **No third public transport kind**
   - there is no public “bundle” transport contract
   - if a route is a resource route, it must be modeled as a real JSON:API document
   - if it cannot be modeled honestly as a resource route, it stays a command route

6. **Migration must be incremental**
   - one route family at a time
   - `exampleapp` should remain working between steps

## Important Wrinkles

### 1. Some JSKIT “resource files” are not one resource type

Example:

- `jskit-ai/packages/workspaces-core/src/shared/resources/workspaceMembersResource.js`

That file contains:

- role catalog output
- members bundle output
- invites bundle output
- command bodies

So JSON:API `type` cannot be derived mechanically from file or namespace. Some operations will need their own explicit transport type.

### 2. Current list query transport is not JSON:API

Current CRUD/resource list routes use JSKIT-style query params such as:

- `cursor`
- `limit`
- `q`
- `include`

Target JSON:API-style query contract should use:

- `page[...]`
- `filter[...]`
- `fields[TYPE]`
- `sort`
- `include`

This is a separate transport concern from body/response envelopes and should be migrated deliberately.

### 3. Some current route outputs are aggregate legacy shapes

Examples:

- workspace members:
  - `{ workspace, members, roleCatalog }`
- workspace invites:
  - `{ workspace, invites, roleCatalog }`
- assistant conversation messages:
  - `{ page, pageSize, total, totalPages, conversation, entries }`
- pending invitations list:
  - `{ pendingInvites: [...] }`

These are not clean JSON:API documents today.

For this migration, they are not a third target transport kind. They are just legacy outputs that must be:

- remodeled into proper JSON:API resource/collection documents
- or left as commands if they cannot be modeled honestly as resources

### 4. Error handling is currently plain

Current Fastify error handling emits:

```json
{
  "error": "Validation failed.",
  "code": "validation_failed",
  "fieldErrors": { ... },
  "details": { ... }
}
```

Resource routes need JSON:API `errors` documents instead, while command routes should keep the current envelope.

## Migration Strategy

Build the infrastructure first, but do not opt any route family in until the transport layer is ready.

The safe path is:

1. shared helpers
2. server opt-in transport support
3. client opt-in transport support
4. resource metadata
5. generator support
6. migrate one clean CRUD family
7. migrate built-in resource families one by one
8. remodel aggregate legacy resource routes later
9. leave true command routes alone

## Phase 0: Freeze the Contract

Goal: decide the public wire contract before implementation.

### Tasks

1. Define route transport kinds:
   - `command`
   - `jsonapi-resource`

2. Define JSON:API `type` ownership:
   - explicit operation-level metadata
   - no implicit namespace-only inference

3. Define which JSON:API document shapes are allowed:
   - `record`
   - `collection`
   - `no-content`
   - compound document via `included`

4. Define query mapping:
   - `include`
   - `fields[TYPE]`
   - `sort`
   - `filter[...]`
   - `page[...]`

5. Define delete semantics:
   - prefer `204 No Content` for clean resource deletes
   - if a delete route still needs to return a body, justify it explicitly and classify the route accordingly

6. Define auxiliary data placement:
   - resource fields -> `data.attributes`
   - ids -> `data.id`
   - sidecars and pagination -> `meta`
   - included related resources -> `included`
   - relationship linkages -> `relationships`
   - top-level and resource navigation links -> `links`

7. Define error policy:
   - resource routes -> JSON:API `errors`
   - command routes -> existing JSKIT error shape

### Result

No runtime changes yet. `exampleapp` remains untouched.

## Phase 1: Shared JSON:API Transport Utilities

Goal: add pure helpers without changing route behavior.

### Status

`in progress`

### Tasks

1. In `http-runtime`, add helpers for:
   - plain record -> JSON:API record document
   - plain list page -> JSON:API collection document
   - JSON:API record document -> plain record
   - JSON:API collection document -> plain page shape
   - JSON:API compound document -> current plain UI model
   - JSON:API error document -> normalized client error

2. Replace or supersede:
   - `jskit-ai/packages/http-runtime/src/shared/validators/jsonApiResponses.js`

3. Add query encode/decode helpers for:
   - internal plain list query <-> JSON:API query params

4. Add tests for:
   - single record
   - collection + pagination meta
   - sidecar meta/lookups
   - validation errors
   - generic errors

### Result

No routes changed. `exampleapp` still behaves exactly as now.

### Progress

- [x] added shared JSON:API transport helpers in `@jskit-ai/http-runtime`
- [x] added normalized document/resource helpers
- [x] superseded the old narrow response simplifier while keeping the legacy `simplifyJsonApiDocument(...)` entrypoint
- [x] taught the shared HTTP client to treat `application/vnd.api+json` and other `+json` media types as JSON
- [x] added reusable JSON:API route-contract helpers in `@jskit-ai/http-runtime` for:
  - [x] request body transport schemas
  - [x] success response transport schemas
  - [x] JSON:API error response schemas
  - [x] route `transport` hooks
  - [x] one-shot route contract assembly for clean resource routes
- [x] added client-side JSON:API resource transport helpers for:
  - [x] write-body encoding
  - [x] record decoding
  - [x] collection decoding back into JSKIT paged-list shape
  - [x] JSON:API error decoding back into current `fieldErrors` shape
- [x] added focused helper/client/export tests
- [x] JSON:API query encode/decode helpers
- [ ] broader tests for pagination/lookups/error decoding

## Phase 2: Opt-In Server Transport Support

Goal: allow JSKIT routes to declare JSON:API resource transport without changing existing routes.

### Status

`in progress`

### Tasks

1. Add a public route transport option to the kernel HTTP layer.

2. Extend route compilation so `jsonapi-resource` routes can provide:
   - request body transport schema
   - request query transport schema
   - request input transform
   - response transport schema
   - route marker for error serialization

3. Add a formal response transform seam.
   - Current route registration has request transforms but no public response transform support.

4. Register `application/vnd.api+json` parsing in the kernel Fastify runtime.
   - Use `json-rest-api` Fastify transport as reference:
     - `json-rest-api/plugins/core/connectors/fastify-plugin.js`
     - `json-rest-api/plugins/core/connectors/lib/transport-route-schemas.js`

5. Enforce write content type for resource routes only.

6. Extend Fastify error handling:
   - resource route -> JSON:API errors
   - command route -> current plain error shape

7. Add server tests for:
   - JSON:API body validation
   - JSON:API query validation
   - content-type enforcement
   - response wrapping
   - JSON:API errors
   - command routes remaining unchanged

### Result

The transport seam is live, and the first built-in route family is now opted in. `exampleapp` still builds and the admin server still boots.

### Progress

- [x] added explicit public route transport metadata to the kernel HTTP router
- [x] added transport request transforms applied before route validator input normalization
- [x] added a formal response transform seam via `reply.send(...)`
- [x] projected `transport.kind` into Fastify route config so later error handling can branch on route transport
- [x] added resource-route content-type enforcement for unsafe methods when a route declares a transport content type
- [x] added transport-aware server error serialization hooks
- [x] added the shared JSON:API server adapter layer in `@jskit-ai/http-runtime` that can feed:
  - [x] Fastify request transport schemas
  - [x] Fastify response transport schemas
  - [x] request unwrap transforms
  - [x] success response wrapping
  - [x] JSON:API error documents
- [x] added focused kernel tests for transport metadata, request transform order, and response transforms
- [x] added focused `http-runtime` tests proving the JSON:API route contract compiles through the kernel route validator
- [x] verified `exampleapp` still builds and server boot reaches port bind with no transport regressions
- [x] JSON:API request transport schemas for query
- [x] JSON:API-specific Fastify parsing/validation behavior
- [x] JSON:API query transport schemas and query transforms
- [x] route-family opt-in on a real resource family

## Phase 3: Opt-In Client Transport Support

Goal: let the client speak JSON:API for resource routes while leaving UI code plain.

### Status

`in progress`

### Tasks

1. Extend `createHttpClient()` request options with resource transport support.

2. For resource transport:
   - send `Accept: application/vnd.api+json`
   - send `Content-Type: application/vnd.api+json` on writes
   - encode simplified writes into JSON:API
   - decode JSON:API success payloads into current plain shapes
   - decode JSON:API errors into current `fieldErrors`/message shape

3. Keep command behavior unchanged.

4. Preserve list runtime expectations:
   - `usePagedCollection()` expects plain page objects such as `{ items, nextCursor }`
   - decoded JSON:API collection responses must preserve that plain contract

5. Add client tests for:
   - request body encoding
   - list decoding
   - field error extraction
   - generic error extraction
   - no-op behavior for commands

### Result

Shared client transport is live, and the first built-in route family now uses it. `exampleapp` still builds and the admin server still boots.

### Progress

- [x] extended the shared HTTP client with an explicit `jsonapi-resource` request transport mode
- [x] added automatic `Accept: application/vnd.api+json` for resource transport requests
- [x] added automatic JSON:API request-body encoding for resource writes
- [x] added JSON:API record decoding back into plain JSKIT objects
- [x] added JSON:API collection decoding back into `{ items, nextCursor, meta, links }`
- [x] added JSON:API error decoding into the existing client `message/code/fieldErrors` shape
- [ ] preserve resource-level `relationships` / `links` / `meta` and top-level `included` in decoded JSON:API results before migrating route families that rely on compound documents
- [x] added transport-aware shared client composable seams in `users-web` for:
  - [x] single-resource reads/writes
  - [x] list reads
  - [x] higher-level add/edit and view wrappers
- [x] added focused client/runtime tests proving command behavior remains unchanged
- [x] added support for independent JSON:API request and response types in the shared client transport contract
- [x] query encoding for JSON:API list params (`page[...]`, `filter[...]`, `fields[...]`, `sort`, `include`)
- [x] first real route-family opt-in using the client transport

## Phase 4: Add Resource Transport Metadata

Goal: make resource routes own their public wire contract explicitly.

### Tasks

1. Add operation-level transport metadata:
   - transport kind
   - JSON:API type
   - response shape
   - relationship/include/link behavior where needed

2. Support:
   - `record`
   - `collection`
   - `no-content`
   - compound document via `included`

3. For current aggregate legacy outputs, define explicit JSON:API remodel rules instead of inventing a third transport kind.

### Result

No route behavior changes until a route opts in.

## Phase 5: Teach the Generators

Goal: newly generated code comes out correct.

### Tasks

1. Update `crud-server-generator`:
   - generated resource routes use `jsonapi-resource`
   - generated create/view/update/list routes emit JSON:API transport
   - generated delete should prefer `204` for clean deletes

2. Update `crud-ui-generator`:
   - generated pages/composables use resource transport-aware client calls
   - UI keeps receiving plain records/pages

3. Update template tests and scaffolding fixtures.

### Result

Old apps stay unchanged. New scaffolds are correct.

### Progress

- [x] `crud-server-generator` now emits `jsonapi-resource` route contracts for generated CRUD routes
- [x] generated CRUD list/view/create/update routes now speak JSON:API over HTTP
- [x] generated CRUD delete routes now prefer `204 No Content`
- [x] `crud-ui-generator` now emits explicit JSON:API client transport options for generated list/view/create/edit pages
- [x] generator template tests updated to pin the transport contract at the template source
- [x] route scaffolding fixture tests updated to pin generated CRUD route transport behavior

## Phase 6: Pilot on One Clean CRUD Family

Goal: prove the design end to end on the smallest clean case.

### Status

`done`

### Target

- `contacts` in `exampleapp`

Why:

- clear record/list semantics
- no aggregate bundle response
- generator-driven
- easy to inspect in the browser network tab

### Tasks

1. Regenerate server scaffold.
2. Regenerate client scaffold.
3. Verify:
   - list returns JSON:API collection document over HTTP
   - view returns JSON:API record document over HTTP
   - create accepts and returns JSON:API
   - patch accepts and returns JSON:API
   - delete returns `204` for clean delete behavior
   - UI still gets plain objects

### Result

`contacts` is fully migrated end to end. Everything else remains plain.

### Progress

- [x] regenerated the `contacts` server scaffold in `exampleapp`
- [x] regenerated the `contacts` UI scaffold in `exampleapp`
- [x] verified in-browser that `contacts` list requests return JSON:API collection documents
- [x] verified in-browser that `contacts` view requests return JSON:API record documents
- [x] verified in-browser that `contacts` create requests send and receive JSON:API
- [x] verified in-browser that `contacts` patch requests send and receive JSON:API
- [x] verified in-browser that authenticated `contacts` delete returns `204`
- [x] verified that the regenerated contacts UI still consumes plain decoded objects
- [x] verified that unauthenticated `contacts` resource-route failures now return JSON:API errors instead of serializer failures

## Phase 7: Migrate Built-In Clean Resource Families

Goal: migrate the obvious resource families one at a time.

### Recommended Order

1. `console-core` console settings
2. `users-core` account settings/profile/preferences/notifications
3. `workspaces-core` workspace directory
4. `workspaces-core` workspace settings
5. `workspaces-core` workspace role catalog
6. `assistant-runtime` assistant settings
7. `assistant-runtime` assistant conversations list

### Progress

- [ ] `console-core` console settings
- [x] `users-core` account settings/profile/preferences/notifications
  - [x] server routes moved to explicit JSON:API transport contracts
  - [x] `users-web` account settings runtime now uses the JSON:API client transport
  - [x] focused route/client tests updated for split request/response types
  - [x] browser-level verification of the settings screens in `exampleapp`
- [ ] `workspaces-core` workspace directory
- [ ] `workspaces-core` workspace settings
- [ ] `workspaces-core` workspace role catalog
- [ ] `assistant-runtime` assistant settings
- [ ] `assistant-runtime` assistant conversations list

### Rule

For each family:

- migrate server and matching client together
- verify `exampleapp`
- do not start the next family until the current one is stable

## Phase 8: Remodel Aggregate Legacy Resource Routes

Goal: convert current aggregate legacy outputs into honest JSON:API resource documents.

### Candidates

1. workspace members list response
2. workspace member role update response
3. workspace member remove response
4. workspace invites list response
5. workspace invite create response
6. workspace invite revoke response
7. assistant conversation messages list response
8. pending invitations list response

### Tasks

1. Define the primary data resource for each route.
2. Decide what belongs in:
   - `data`
   - `included`
   - `meta`
   - `relationships`
   - `links`
3. Extend the `jsonapi-resource` request/response schemas so `relationships` and compound `included` documents are first-class validated transport members instead of runtime-only hooks.
4. Make the client simplifier reconstruct the current plain UI model.
5. If a route cannot be remodeled honestly as a resource route, reclassify it as a command route instead of inventing a custom transport.

### Rule

Do not attempt these until clean resource families are stable.

### Companion Clean Resource Prerequisite

Before remodeling the workspace members/invites family, migrate `workspace.roles.list` as its own clean JSON:API route.

Reason:

- current aggregate responses inline `roleCatalog`
- that data is already conceptually a separate singleton resource
- migrating it first lets the members/invites routes stop embedding catalog data and return honest primary data instead

### Aggregate Legacy Route Decision Table

| Current route / action | Current shape | Target classification | Target primary data | Included / relationships / links / meta | Client follow-up / notes |
| --- | --- | --- | --- | --- | --- |
| `GET /api/w/:workspaceSlug/members` / `workspace.members.list` | `{ workspace, members, roleCatalog }` | `jsonapi-resource` | collection of `workspace-memberships` | each membership relates to `workspace` and `user`; no inline `roleCatalog`; fetch role catalog from `workspace.roles.list`; include related resources only via explicit `include` | expose a stable membership resource id; do not keep returning the whole workspace bundle |
| `PATCH /api/w/:workspaceSlug/members/:memberUserId/role` / `workspace.member.role.update` | `{ workspace, members, roleCatalog }` | `jsonapi-resource` | updated `workspace-membership` record | same membership relationships as list route; no aggregate body | response should stop returning the full members list; client invalidates/refetches the members collection |
| `DELETE /api/w/:workspaceSlug/members/:memberUserId` / `workspace.member.remove` | `{ workspace, members, roleCatalog }` | `jsonapi-resource` | no content | standard resource delete; `links.self` is enough if we emit any headers/links at all | prefer `204`; client invalidates/refetches the members collection |
| `GET /api/w/:workspaceSlug/invites` / `workspace.invites.list` | `{ workspace, invites, roleCatalog }` | `jsonapi-resource` | collection of `workspace-invites` | each invite relates to `workspace`; no inline `roleCatalog`; companion role catalog route stays separate; include related workspace only via explicit `include` | keep the list route focused on invite resources, not aggregate settings data |
| `POST /api/w/:workspaceSlug/invites` / `workspace.invite.create` | `{ workspace, invites, roleCatalog, inviteTokenPreview, createdInviteId }` | `jsonapi-resource` | created `workspace-invite` record | primary data is the created invite; if raw preview token remains a supported feature, carry it in top-level `meta.inviteTokenPreview`, not in a fake aggregate resource; `createdInviteId` disappears because `data.id` already carries it | client invalidates/refetches invites list; if preview token is only a dev/testing aid, remove it entirely instead of baking it into the long-term contract |
| `DELETE /api/w/:workspaceSlug/invites/:inviteId` / `workspace.invite.revoke` | `{ workspace, invites, roleCatalog, revokedInviteId }` | `jsonapi-resource` | no content | standard resource delete; no aggregate body; `revokedInviteId` disappears because the route already identifies the resource | prefer `204`; client invalidates/refetches invites list |
| `GET /api[/w/:workspaceSlug]/assistant/:surfaceId/conversations/:conversationId/messages` / `assistant.conversationMessages.list` | `{ page, pageSize, total, totalPages, conversation, entries }` | `jsonapi-resource` | collection of `assistant-messages` | parent conversation exposed as a relationship and included resource; pagination moves to JSON:API `links` and `meta` | keep the conversation resource in `included` until there is a separate clean conversation view route the page can rely on |
| `GET /api/workspace/invitations/pending` / `workspace.invitations.pending.list` | `{ pendingInvites: [...] }` | `jsonapi-resource` | collection of `workspace-pending-invitations` | each pending invitation relates to a `workspace`; include workspace resources only when explicitly requested or when the page truly needs compound data immediately | keep `token` as an attribute because the separate redeem route uses it; `workspace.invite.redeem` itself remains a command route |

## Phase 9: Leave True Commands Alone

These should remain command-shaped:

- auth routes
- account security flows
- assistant chat stream
- multipart upload routes
- binary download routes
- workspace invite redeem
- any imperative/non-resource workflow

Optional later work:

- allow command bodies to contain nested JSON:API documents for specific fields
- keep the top-level route contract command-shaped

## Phase 10: Documentation

### Tasks

1. Document the transport split:
   - resource routes
   - command routes

2. Document route authoring conventions.

3. Document client transport usage.

4. Document JSON:API query mapping.

5. Document route classification guidance:
   - clean resource
   - aggregate legacy resource route
   - command
   - file/binary/stream

## Route Classification Summary

### Tier 1: Clean Resource Routes

Migrate early.

- generated CRUDs like `contacts`
- console settings
- user settings/profile/preferences/notifications
- workspace directory
- workspace settings
- workspace role catalog
- assistant settings
- assistant conversations list

### Tier 2: Aggregate Legacy Resource Routes

Migrate later.

- workspace members bundle
- workspace member role update response
- workspace member remove response
- workspace invites bundle
- workspace invite create response
- workspace invite revoke response
- assistant conversation messages bundle
- pending invitations list

### Tier 3: True Commands / Files / Streams

Leave command-shaped.

- auth
- account security
- avatar upload/download
- invite redeem
- assistant chat stream

## How to Keep `exampleapp` Working Throughout

1. Build infrastructure first with **no opt-in routes**.
2. Migrate **one route family at a time**.
3. Switch the **server family and matching client family together**.
4. Do **not** rely on global auto-detection.
5. Keep non-migrated families on plain transport until their turn.

## Reference Points

### Existing JSKIT seams

- request validation and transport schema compilation:
  - `jskit-ai/packages/kernel/server/http/lib/routeValidator.js`
- route registration and request transform hook:
  - `jskit-ai/packages/kernel/server/http/lib/routeRegistration.js`
- plain client runtime:
  - `jskit-ai/packages/http-runtime/src/shared/clientRuntime/client.js`
- current JSON:API simplifier:
  - `jskit-ai/packages/http-runtime/src/shared/validators/jsonApiResponses.js`

### `json-rest-api` reference transport

- Fastify connector:
  - `json-rest-api/plugins/core/connectors/fastify-plugin.js`
- Fastify transport route schemas:
  - `json-rest-api/plugins/core/connectors/lib/transport-route-schemas.js`
- JSON:API request contracts:
  - `json-rest-api/plugins/core/lib/querying-writing/request-contracts.js`

## Implementation Constraint

No route family should be switched until:

- server request translation exists
- server response translation exists
- client request encoding exists
- client response decoding exists
- resource-route error translation exists
- list query transport strategy is defined
- link/relationship policy is defined

Otherwise the migration will produce half-resource, half-command behavior and break `exampleapp` in the middle.
