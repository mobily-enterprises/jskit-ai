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

- [x] Update `jskit help` output to expose the non-CRUD server lane
- [x] Update `jskit list generators` discoverability
- [x] Update `jskit show --details` ownership explanations
- [x] Add examples such as `booking-engine`, `availability-engine`, and `billing-engine`
- [x] Improve failure/help text so users are steered to the new generator instead of ad hoc edits
- [ ] User reviewed Group 5

Review notes:

- Top-level `jskit` help and `jskit help generate` now surface the standard non-CRUD server lane directly instead of assuming the user already knows the right generator.
- `jskit generate` and `jskit list generators` now expose `feature-server-generator` more clearly with primary-subcommand labeling plus command examples like `booking-engine`, `availability-engine`, and `billing-engine`.
- `jskit show feature-server-generator --details` now explains the lane ownership contract: provider wires DI, service owns orchestration, repository owns persistence, and `packages/main` stays glue/composition only.
- Generator/runtime failure text now points users to `jskit add package ...` for runtime packages and to `jskit generate feature-server-generator scaffold <feature-name>` for new substantial non-CRUD server features.

## Group 6: Tests

- [x] Add generator tests for each scaffold mode
- [x] Add file inventory tests for emitted packages
- [x] Add service contract tests proving generated services do not talk to persistence directly
- [x] Add repository contract tests for default `json-rest-api` usage
- [x] Add doctor tests for every new anti-pattern
- [x] Add an end-to-end fixture test showing a generated feature package lands outside `packages/main`
- [ ] User reviewed Group 6

Review notes:

- `tooling/jskit-cli/test/featureServerGeneratorPackage.test.js` covers the three scaffold modes, route gating, adoption path, and generator help/examples.
- `tooling/jskit-cli/test/featureServerGeneratorContract.test.js` adds exact emitted file inventories, generated service delegation checks, default `json-rest-api` repository seam checks, and an end-to-end fixture proving generated feature packages land under `packages/<feature>/` instead of `packages/main`.
- `tooling/jskit-cli/test/doctorFeatureLaneValidation.test.js` covers every Group 4 anti-pattern: direct service/provider persistence work, missing repositories, default-lane repository bypass, `packages/main` creep warnings, and hand-made feature topology warnings.
- `packages/feature-server-generator/test/*.test.js` still covers descriptor/template-context invariants at the package level, so the repo now has generator-unit, CLI-integration, contract, and doctor coverage for this lane.

## Group 7: Migration And Cleanup

- [x] Audit existing substantial feature logic living in `packages/main`
- [x] Move real domain features into dedicated packages with their own providers
- [x] Move service-level persistence code down into repositories or remove fake repository layers where persistence is not needed
- [x] Mark any unavoidable exceptions as explicit weird/custom lane cases
- [x] Re-run relevant doctor/test suites after migration
- [ ] User reviewed Group 7

Review notes:

- The repo did not contain a real root-app `packages/main` feature implementation to extract; the remaining drift was the base-shell app template, which still shipped a feature-inviting `services/controllers/routes` tree and nested server provider paths.
- The migration flattened the `@local/main` server scaffold to `src/server/index.js`, `src/server/MainServiceProvider.js`, and `src/server/loadAppConfig.js`, removed the placeholder feature folders, and encoded the glue-only rule directly in `packages/main/package.descriptor.mjs`.
- `doctor` now treats the flattened local-main shape as the preferred baseline while still tolerating the legacy scaffold shape for older apps; new direct server files under `packages/main` still trigger the existing glue-only warning.
- No explicit weird/custom lane exceptions were required, because there was no unavoidable direct-persistence feature living in `packages/main`.

## Final Done Criteria

- [x] A request like “add booking-engine” has a command-backed answer
- [x] The default output is always a dedicated package with its own provider
- [x] Services cannot silently become persistence layers
- [x] Default-lane repositories use internal `json-rest-api` first
- [x] `packages/main` stops being the accidental home for substantial domain features
- [x] `doctor`, docs, CLI, and generators all enforce the same lane
