# JSKIT Resource Repository JSON:API Migration Todo

## Goal

Adopt a stricter internal rule for **resource flows**:

- resource repositories are **JSON:API-native**
- resource services/actions preserve **JSON:API**
- resource HTTP routes return **JSON:API** directly
- the client is the place where resource documents may be simplified for rendering

This is a separate migration from the existing transport migration.

The transport migration answered:
- how JSON:API gets onto the wire

This migration answers:
- whether **resource repositories and resource services** should stay JSON:API-native internally

## Root Cause

The current CRUD/resource stack still treats JSON:API mostly as an HTTP-boundary concern.

That means:

- repositories return plain records or plain list pages
- services/actions work with plain resource-shaped objects
- route transport wraps those plain objects back into JSON:API
- the client decodes them back into plain objects

That layering is coherent, but it creates two problems:

1. `json-rest-api` is not the real resource engine for generated CRUD.
2. Resource flows are flattened and rebuilt, instead of preserving the resource contract.

The user preference is stricter and cleaner:

- if something is a **resource repository**, it should return **JSON:API natively**
- this should remain true even when the repository does real work beyond simple passthrough calls

## Target Rule

### Resource Repositories

- Inputs:
  - `trx`
  - `context`
  - resource-specific params such as `id`, `queryParams`, `inputRecord`
- Outputs:
  - JSON:API resource document
  - JSON:API collection document
  - `null` only where we deliberately keep repository-style “not found returns null” semantics

### Resource Services

- may enforce policy
- may orchestrate multiple repository calls
- may reshape includes/meta/links/relationships
- must still return JSON:API documents for resource flows

### Resource Actions

- may assemble or validate business input
- must return JSON:API documents for resource flows
- should not flatten repository results into plain records

### Resource HTTP Routes

- request handling may still normalize route params / query / body
- response handling should not rebuild JSON:API if the action already returned it

### Client

- may decode JSON:API into plain runtime objects for UI use
- remains the only sanctioned “plainification” layer for resource rendering

## Non-Goals

- changing command routes to JSON:API internally
- forcing command repositories/helpers to return JSON:API
- doing this migration implicitly as part of the existing transport rollout
- hiding the change inside large generic runtime layers

## Design Rules

1. **One context name only**
   - use `context`
   - do not use `resourceContext`
   - do not support both

2. **Resource repos are honest adapters**
   - if a repository is backed by `json-rest-api`, it should expose that resource model honestly

3. **No flatten-and-rebuild cycle**
   - do not flatten repository JSON:API output to plain objects only to wrap it again later

4. **App-owned code should stay editable**
   - prefer readable repository methods over opaque generic runtime indirection

5. **Commands and resources remain separate**
   - resource flows may stay JSON:API-native
   - commands may stay plain internally

## Architectural Consequences

If this migration is accepted, then for resource flows:

- `crud-core` cannot remain the central plain-object resource runtime in its current role
- generated repositories should become thin `json-rest-api` adapters
- generated services/actions should stop assuming plain output
- route-side response wrapping for resource routes should shrink or disappear

This is not a small cleanup. It is a contract migration.

## Locked Decisions

The following choices are fixed for this migration:

- [x] Repository method options use one canonical shape:
  - `{ trx = null, context = null }`
- [x] `resourceContext` is banned
- [x] Repository `findById()` returns `null` on not found
- [x] Repository list methods return JSON:API collection documents directly
  - preserve JSON:API `data`
  - preserve JSON:API `meta`
  - preserve JSON:API `links`
- [x] Repository delete methods return `null`
- [x] Request-side JSON:API normalization stays at the route boundary for now
  - routes may still normalize params/query/body into action input
  - this migration does not force actions/services to accept raw JSON:API request documents
- [x] Resource services/actions preserve JSON:API output for resource flows
  - they may orchestrate or reshape when the business case genuinely demands it
  - they should not partially unwrap resource documents into plain records as a default

## Migration Strategy

Do this as a dedicated incremental migration, not mixed into other work.

Safe order:

1. define the repository contract
2. pilot one repository family
3. migrate the matching service/action flow
4. simplify the matching route response path
5. teach generators
6. roll out to additional resource families

## Phase 0: Freeze the Contract

Status: [x] Done

Goal: make the internal resource contract explicit before changing code.

### Tasks

- [x] Define the canonical repository method option shape:
  - `{ trx = null, context = null }`
- [x] Ban `resourceContext`
- [x] Decide `findById()` not-found semantics
  - return `null`
- [x] Decide whether list methods return raw JSON:API collection documents unchanged
  - yes
  - preserve `data`, `meta`, and `links`
- [x] Decide whether resource services/actions are allowed to partially unwrap JSON:API
  - no, not as the default architecture for resource flows
  - only deliberate orchestration/reshaping is allowed
- [x] Record the rule that the client is the preferred simplification boundary for resource UI
- [x] Decide delete repository semantics
  - return `null`
- [x] Decide request-side normalization scope
  - keep JSON:API request normalization at the route boundary for now

### Result

The repository/service/action contract for the pilot is now explicit.
No code change yet.

## Phase 1: Contacts Pilot Repository

Goal: replace the generated `contacts` repository with a thin `json-rest-api` adapter.

Status: [x] Done

### Tasks

- [x] Create an internal JSON:API host/resource setup for `contacts`
- [x] Replace the generated `resourceRuntime` repository implementation
- [x] Implement thin repository methods for:
  - `findById`
  - `list`
  - `create`
  - `updateById`
  - `deleteById`
- [x] Use only:
  - `trx`
  - `context`
- [x] Remove `resourceContext`
- [x] Keep repository methods readable and app-owned

### Guardrails

- [x] No generic runtime indirection introduced to replace `crud-core`
- [x] No plain-object return from the repository for resource methods unless explicitly approved

## Phase 2: Contacts Service/Action Migration

Goal: stop flattening the `contacts` resource flow after the repository.

Status: [x] Done

### Tasks

- [x] Update `contactsService` methods to return JSON:API documents
- [x] Update `contacts` actions to preserve JSON:API output
- [x] Remove plain-record assumptions from the `contacts` resource action/service path
- [x] Keep command/resource distinction intact

### Questions to answer during implementation

- [x] Does `include` remain an action input concern or move deeper into repository/service calls?
  - Keep it as an action input concern for now and forward it to repository reads.
- [x] Are action outputs still validated at the action layer, and if so, against which contract?
  - Yes. Validate them as JSON:API resource/collection documents via the JSON:API action output validators.

## Phase 3: Contacts Route Simplification

Goal: stop rebuilding resource responses in the route transport layer for the pilot family.

Status: [x] Done

### Tasks

- [x] Decide whether `contacts` routes still need response transport wrapping
- [x] If the action already returns JSON:API, remove duplicate response wrapping
- [x] Keep request validation and auth behavior correct
- [x] Verify resource errors remain JSON:API-shaped

### Result

For `contacts`, repository -> service -> action -> route response should preserve one consistent resource contract.

## Phase 4: Generator Migration

Goal: make new CRUD scaffolds come out in the new architecture.

Status: [x] Done for the baseline CRUD path proven by `contacts`

### Tasks

- [x] Update `crud-server-generator` to emit:
  - thin JSON:API-backed repositories
  - JSON:API-native service/action resource flow
- [x] Remove generated `crud-core` pass-through repository wrappers for resource CRUD
- [x] Keep generated code editable and obvious
- [x] Add generator tests proving:
  - `context` is the only context option
  - no `resourceContext`
  - repositories do not return plain records for resource methods

### Verification

- [x] Regenerated `contacts` from the updated generator
- [x] Built and booted `exampleapp`
- [x] Verified with Playwright:
  - authenticated list `GET` returns JSON:API collection
  - authenticated create `POST` returns JSON:API record
  - authenticated update `PATCH` returns JSON:API record
  - authenticated delete `DELETE` returns `204`
  - subsequent `GET` returns JSON:API `404`

## Phase 5: Evaluate `crud-core`

Goal: determine what remains of `crud-core` after resource repositories become JSON:API-native.

### Questions

- [ ] Does `crud-core` still have a role for:
  - field access
  - list config
  - validation helpers
  - generator metadata
- [ ] Should `crud-core` be narrowed to helper utilities only?
- [ ] Should JSON:API-backed resource repos fully replace it for generated CRUD persistence?

This phase is analysis first, not automatic deletion.

## Phase 6: Broader Rollout

Goal: migrate additional resource families after `contacts` proves the pattern.

### Candidate families

- [ ] next generated CRUD package
- [ ] workspace settings
- [ ] user settings/profile
- [ ] other clean resource flows

### Constraints

- [ ] migrate one family at a time
- [ ] keep `exampleapp` working between steps
- [ ] do not mix command-route refactors into resource-repository work

## Risks

1. **Halfway migration**
   - repo returns JSON:API
   - service/action flattens it anyway
   - route wraps again

2. **Generator drift**
   - hand-fixed pilot
   - generators still emit old architecture

3. **Command/resource confusion**
   - resource rule applied to command helpers
   - command rule applied to resource repos

4. **Hidden context ambiguity**
   - `context` and `resourceContext` coexist
   - different repositories expect different names

## Success Criteria

This migration is successful when:

- generated resource repositories no longer depend on hidden CRUD runtime indirection
- `context` is the only repository context name
- resource repositories return JSON:API natively
- resource services/actions preserve JSON:API
- route responses for resource flows stop rebuilding documents unnecessarily
- the client remains the preferred resource simplification boundary for UI

## Notes

- This TODO is intentionally separate from:
  - [JSKIT_RESOURCE_TRANSPORT_MIGRATION_TODO.md](/home/merc/Development/current/jskit-ai/JSKIT_RESOURCE_TRANSPORT_MIGRATION_TODO.md)
- The transport TODO is still about HTTP boundary behavior.
- This TODO is about internal resource contracts and ownership.
