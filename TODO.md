# TODO

## Done

- [x] Re-read the repository `AGENTS.md`.
- [x] Refreshed the JSKIT pattern index in `packages/agent-docs/patterns/INDEX.md`.
- [x] Re-read the CRUD scaffolding pattern in `packages/agent-docs/patterns/crud-scaffolding.md`.
- [x] Re-read the client request pattern in `packages/agent-docs/patterns/client-requests.md`.
- [x] Confirmed that `crud-server-generator` supports `--internal` for internal HTTP CRUD routes.
- [x] Confirmed the current Google rewarded direction: `google-rewarded-core` plus `google-rewarded-web`.

## Scope and Constraints

- [x] Keep the module Google-only on day 0.
- [x] Treat the feature as a rewarded unlock gate, not a generic ad provider framework.
- [x] Use internal CRUD ownership for persisted entities instead of handwritten direct-knex repositories where CRUD fits.
- [x] Keep workflow logic separate from persisted entity ownership.
- [x] Avoid placement-based or route-page-based gating hacks.
- [x] Keep the default product model aligned with rewarded unlocks rather than “hard block all normal use.”

## Phase 1: Finalize Package Shape

- [x] Define the exact package ids and directory names for:
  - `@jskit-ai/google-rewarded-core`
  - `@jskit-ai/google-rewarded-web`
- [x] Define the exact CRUD provider/resource namespaces inside `google-rewarded-core` before scaffolding.
- [x] Decide whether any day-0 admin/config UI is in scope or deferred.
- [x] Decide the package dependency graph:
  - `google-rewarded-core` runtime/server dependencies
  - `google-rewarded-web` client/runtime dependencies
- [x] Decide which existing JSKIT capabilities each package provides and requires.
- [x] Decide whether workspace-aware behavior is first-class on day 0 or only global/user-level behavior is in scope.

## Phase 2: Define Data Ownership and CRUD Boundaries

- [x] Finalize the persisted entity list.
- [x] Confirm which tables are CRUD-owned and which logic stays workflow-only.
- [x] Finalize day-0 tables:
  - `google_rewarded_rules`
  - `google_rewarded_provider_configs`
  - `google_rewarded_unlock_receipts`
  - `google_rewarded_watch_sessions`
- [x] Finalize ownership per table:
  - `workspace` for rule/config tables if they are workspace-scoped
  - `workspace_user` for per-user unlock/session tables in workspace apps
  - `user` instead when no workspace scoping applies
- [x] Verify every user/workspace-owned table has direct owner columns and does not rely on inherited ownership.
- [x] Confirm no table requires a mixed-visibility contract.

## Phase 3: Create the CRUD-Owned Entity Layer

- [x] Finalize the real table/resource contracts for the four day-0 tables:
  - columns
  - ownership columns
  - foreign keys
  - indexes
  - required constraints
- [x] Scaffold the four CRUD providers/resources via `exampleapp` so the generated migrations own the schema from the start.
- [x] Scaffold each entity with `crud-server-generator scaffold --internal`.
- [x] Confirm the generated CRUD package material is valid and installable through the normal JSKIT package flow.
- [x] Verify the generated CRUD material has:
  - migration
  - resource
  - provider
  - repository
  - service
  - actions
  - internal HTTP routes
- [x] Verify the generated shared resources reflect the real table contracts.
- [x] Adjust generated resources only where the DB contract requires explicit metadata refinement.
- [x] Verify doctor recognizes the tables as CRUD-owned and not as undocumented exceptions.

## Phase 4: Build `google-rewarded-core`

- [x] Create `packages/google-rewarded-core/package.descriptor.mjs`.
- [x] Keep package-level migrations out of `google-rewarded-core` unless a real non-CRUD workflow table is explicitly justified.
- [x] Add the server provider:
  - `src/server/GoogleRewardedCoreProvider.js`
- [x] Wire server container tokens for the gate workflow service.
- [x] Decide whether the workflow service consumes CRUD services, CRUD repositories, or both.
- [x] Add the core gate decision service.
- [x] Define and implement the unlock policy:
  - current lock state
  - unlock duration
  - cooldown
  - repeat watch behavior
  - daily/session caps if any
- [x] Define and implement session lifecycle rules:
  - started
  - granted
  - closed
  - expired/abandoned
- [x] Keep business logic in services, not in route handlers.

## Phase 5: Define the Server Workflow API

- [x] Finalize the custom endpoint set.
- [x] Likely endpoints:
  - `GET /api/google-rewarded/current`
  - `POST /api/google-rewarded/start`
  - `POST /api/google-rewarded/grant`
  - `POST /api/google-rewarded/close`
- [x] Define exact request/response contracts for each endpoint.
- [x] Use JSKIT HTTP runtime contracts instead of ad hoc payload handling.
- [x] Keep these endpoints as plain workflow payloads with explicit contracts, not JSON:API documents.
- [x] Ensure route auth/surface handling is explicit and consistent.
- [x] Ensure route registration matches the intended internal/public exposure model.
- [x] Add server tests for the workflow contracts and happy/failure paths.

## Phase 6: Google GPT Integration Design

- [x] Finalize the Google API surface being used on day 0:
  - GPT rewarded ads for web
- [x] Confirm the exact GPT event set the module will rely on.
- [x] Day-0 event handling should cover:
  - slot ready
  - reward granted
  - slot closed
  - video completed if useful
- [x] Define which event is authoritative for unlock grants.
- [x] Define what to do when the ad fails to load or no fill is available.
- [x] Define what to do when the user closes the ad before reward grant.
- [x] Define what minimal provider config must exist in DB/app config.

## Phase 7: Build `google-rewarded-web`

- [x] Create `packages/google-rewarded-web/package.descriptor.mjs`.
- [x] Add the client provider:
  - `src/client/providers/GoogleRewardedClientProvider.js`
- [x] Add a client runtime abstraction for gate requests and GPT orchestration.
- [x] Add a GPT script loader helper.
- [x] Add a rewarded slot controller/helper.
- [x] Add the fullscreen gate host component.
- [x] Define the client token(s) used for the gate runtime/host.
- [x] Ensure the module can mount once at app root and be triggered from anywhere.
- [x] Keep raw provider/GPT integration isolated from app feature code.

## Phase 8: Root App Integration

- [x] Define how the gate host is installed into app roots.
- [x] Avoid needing an app-root template mutation by mounting the host from the client provider while still coexisting conceptually with:
  - `RouterView`
  - `ShellErrorHost`
- [x] Ensure the gate host does not depend on placements.
- [x] Ensure the gate host can block interaction cleanly across supported surfaces.
- [x] Decide whether this root integration should be automatic package mutation or explicit manual app wiring.

## Phase 9: Client Runtime API for Feature Modules

- [x] Define the public client runtime API.
- [x] Likely shape:
  - `requireUnlock({ gateKey, surface, workspaceSlug })`
- [x] Decide whether the runtime also exposes read-only helpers like:
  - current gate state
  - current unlock state
- [x] Ensure app features call the runtime instead of touching GPT directly.
- [x] Ensure the runtime resolves cleanly on:
  - already unlocked
  - rewarded successfully
  - user closed without reward
  - provider/load failure

## Phase 10: Bootstrap and Initial State

- [x] Decide whether day-0 requires bootstrap integration or can start with endpoint-only checks.
- [x] Day 0 stays endpoint-only; no bootstrap contributor/handler is required yet.
- [x] Keep bootstrap out of the critical path until the gate needs boot-time preloading for UX only.

## Phase 11: Settings and Config UX

- [x] Keep day-0 config minimal: DB-backed plus explicit manual setup unless a small settings surface is clearly needed to exercise the flow.
- [x] Day 0 ships without generated or custom settings UI.
- [x] Defer the console/admin settings placement decision until the first real app integration needs it.
- [x] Keep future settings UX aligned with surfaces and placement rules.

## Phase 12: Docs and Guidance

- [x] Document the package purpose and architecture.
- [x] Document the required Google configuration inputs.
- [x] Document the ownership model for each table.
- [x] Document how apps should trigger a rewarded gate from feature code.
- [x] Document failure and fallback expectations when Google does not grant a reward.
- [x] Document any policy caveats about rewarded ads and “normal use.”
- [x] Keep day-0 docs package-local; no agent-docs update was required for this drop.

## Phase 13: Tests and Verification

- [x] Add unit tests for gate decision logic.
- [x] Add route/contract tests for the workflow endpoints.
- [x] Add client/runtime tests for the gate runtime where practical.
- [x] Add tests around GPT event translation if the abstraction allows it.
- [x] Verify generated CRUD contracts still follow JSKIT `Document` / `Documents` expectations.
- [x] Run `jskit doctor` against a representative app/package setup after scaffolding.
- [x] Verify there is no undocumented table exception drift.
- [x] Verify there is no inappropriate direct-knex drift in the workflow layer.

## Phase 14: End-to-End Validation

- [x] Exercise a full “already unlocked” flow.
- [x] Exercise a full “locked -> start -> reward granted -> unlocked” flow.
- [x] Exercise a “locked -> close without reward” flow.
- [x] Exercise a “provider unavailable / no fill / load failure” flow.
- [x] Verify the fullscreen gate blocks interaction only when intended.
- [x] Verify non-gated app flows still work normally.
- [x] Verify the module does not assume machine-local state or unpublished dependencies.

## Deferred / Explicitly Not Day 0

- [x] Do not build multi-provider abstractions yet.
- [x] Do not build a generic internal ad-serving system.
- [x] Do not rely on placements as the primary gate seam.
- [x] Do not reintroduce direct-knex persistence where CRUD ownership should exist.
- [x] Do not model mixed-visibility tables for this feature.
