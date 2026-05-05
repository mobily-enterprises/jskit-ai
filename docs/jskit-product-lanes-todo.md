# JSKIT Product Lanes TODO

Status: active

Purpose:

- turn the product-lanes discussion into one tracked checklist
- keep implementation ordered, reviewable, and easy to audit
- force a pause after each completed group so the shape can be checked before the next group starts

How to use this file:

- work top to bottom
- do not start the next group until the current group has been completed and reviewed
- mark checklist items with `[x]` only when the work is actually done in the repo
- after each group, add a short note under `Review notes`

## Group 0: Tracking Setup

- [x] Create a dedicated product-lanes TODO file in `docs/`
- [x] Convert the discussion into grouped, ordered checklist work
- [x] Add explicit stop-and-review gates between groups
- [x] User reviewed Group 0

Review notes:

- Group 0 only establishes the tracking file and review protocol.

## Group 1: Product Rules

- [x] Add `Standard Non-CRUD Server Lane` to `docs/jskit-product-lanes-rulebook.md`
- [x] State that any substantial generated server feature must be its own package with its own provider
- [x] State that `packages/main` is glue/composition only
- [x] State that agents must start with a JSKIT command when creating new feature/file topology
- [x] State that repositories use internal `json-rest-api` first
- [x] State that raw `knex` in repositories is rare and must be an explicit exception
- [x] State that services must never talk to persistence directly
- [x] Update `docs/jskit-product-lanes-workboard.md` so the execution plan matches the new rulebook requirements
- [x] User reviewed Group 1

Review notes:

- Group 1 adds the explicit non-CRUD server default lane, package-with-provider rule, command-first rule, `packages/main` glue-only rule, and json-rest-first repository boundary.

## Group 2: Generator Product Spec

- [x] Choose the first-party non-CRUD server generator name
- [x] Define the command shape and normal examples
- [x] Define the default persistent scaffold mode
- [x] Define the non-persistent scaffold mode
- [x] Define the explicit rare raw-`knex` scaffold mode
- [x] Define the exact emitted file inventory for each mode
- [x] Define required descriptor metadata for scaffolded packages
- [x] Document the generator contract in repo docs
- [x] User reviewed Group 2

Review notes:

- Group 2 fixes the generator contract around `feature-server-generator scaffold`, its three scaffold modes, the exact file inventory, the generic query/command starter actions, and the descriptor metadata that later `doctor` rules will enforce.

## Group 3: Generator Implementation

- [x] Implement the new generator package or subcommands
- [x] Scaffold `package.descriptor.mjs`
- [x] Scaffold `package.json`
- [x] Scaffold `src/server/<Feature>Provider.js`
- [x] Scaffold `src/server/actionIds.js`
- [x] Scaffold `src/server/inputSchemas.js`
- [x] Scaffold `src/server/actions.js`
- [x] Scaffold `src/server/service.js`
- [x] Scaffold `src/server/repository.js` for persistent modes only
- [x] Scaffold `src/server/registerRoutes.js` when requested by the generator contract
- [x] Reuse the existing generated app-local package adoption path
- [x] Add generator help text and examples
- [ ] User reviewed Group 3

Review notes:

- The generator package, templates, help text, adoption path, and mode-specific repository scaffolds are implemented.
- `registerRoutes.js` is now emitted only when `--route-prefix` has text, using the CLI mutation `when.hasText` gate instead of an empty-string workaround.

## Group 4: Enforcement And Doctor

- [x] Add a `doctor` rule that fails if a default-lane service uses `knex`
- [x] Add a `doctor` rule that fails if a default-lane service imports persistence helpers directly
- [x] Add a `doctor` rule that fails if a default-lane provider performs persistence work directly
- [x] Add a `doctor` rule that fails if a generated persistent feature has no repository
- [x] Add a `doctor` rule that fails if a default-lane persistent repository bypasses internal `json-rest-api` without explicit exception metadata
- [x] Add a `doctor` rule that warns or fails when `packages/main` contains substantial domain feature logic
- [x] Add a `doctor` rule that warns when a complex feature appears hand-made instead of command-generated
- [ ] User reviewed Group 4

Review notes:

- `doctor` now reads `metadata.jskit.scaffoldShape`, `scaffoldMode`, and `lane` from app-local feature-server packages and enforces the service/provider/repository boundary from that contract.
- Default-lane feature packages fail if `service.js` uses `knex`, imports persistence helpers directly, or if the provider appears to perform persistence work instead of wiring the repository seam.
- Persistent generated feature packages fail if `repository.js` is missing, and default-lane `json-rest` repositories fail if they bypass the internal `json-rest-api` path without moving to the explicit weird/custom lane.
- Warning-only heuristics now flag `packages/main` server feature creep and feature-like app-local packages that look hand-made instead of generator-backed.

## Group 5: CLI Guidance

- [ ] Update `jskit help` output to expose the non-CRUD server lane
- [ ] Update `jskit list generators` discoverability
- [ ] Update `jskit show --details` ownership explanations
- [ ] Add examples such as `booking-engine`, `availability-engine`, and `billing-engine`
- [ ] Improve failure/help text so users are steered to the new generator instead of ad hoc edits
- [ ] User reviewed Group 5

Review notes:

- Describe the CLI story a user sees before and after these changes.

## Group 6: Tests

- [ ] Add generator tests for each scaffold mode
- [ ] Add file inventory tests for emitted packages
- [ ] Add service contract tests proving generated services do not talk to persistence directly
- [ ] Add repository contract tests for default `json-rest-api` usage
- [ ] Add doctor tests for every new anti-pattern
- [ ] Add an end-to-end fixture test showing a generated feature package lands outside `packages/main`
- [ ] User reviewed Group 6

Review notes:

- Describe the test matrix and what repo invariants it now enforces.

## Group 7: Migration And Cleanup

- [ ] Audit existing substantial feature logic living in `packages/main`
- [ ] Move real domain features into dedicated packages with their own providers
- [ ] Move service-level persistence code down into repositories or remove fake repository layers where persistence is not needed
- [ ] Mark any unavoidable exceptions as explicit weird/custom lane cases
- [ ] Re-run relevant doctor/test suites after migration
- [ ] User reviewed Group 7

Review notes:

- Describe what was moved, what remains exceptional, and why.

## Final Done Criteria

- [ ] A request like “add booking-engine” has a command-backed answer
- [ ] The default output is always a dedicated package with its own provider
- [ ] Services cannot silently become persistence layers
- [ ] Default-lane repositories use internal `json-rest-api` first
- [ ] `packages/main` stops being the accidental home for substantial domain features
- [ ] `doctor`, docs, CLI, and generators all enforce the same lane
