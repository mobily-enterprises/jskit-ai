# Codebase Audit Report (Excluding `LEGACY/`)

## Scope
- Audited all repository code paths except `LEGACY/`.
- Focus areas: `packages/`, `tooling/`, `docs/examples/`, scripts/config surfaces that affect runtime behavior.
- Excluded dependency noise (`node_modules`) from conclusions.

## Method
- Clone detection run on source paths only:
  - `npx jscpd packages tooling docs tests scripts eslint.architecture.client.mjs vitest.client-element.base.mjs ...`
  - Result: **44 clones**, **1322 duplicated lines**, **3.98% duplication** across **366 files**.
- Manual architectural inspection and targeted deep reviews across `packages`, `tooling`, and `docs/examples`.

## Executive Summary
The non-legacy codebase is not random AI sludge, but it has several **strong AI-generated smell patterns**:
- duplicated implementations of the same contract in different files,
- parallel systems that solve the same problem differently,
- mismatched behavior between similar paths (`client` vs `server`, `template` vs runtime),
- monolithic “god files” with mixed concerns,
- machine-specific assumptions inside generated templates.

These are not cosmetic. Several findings are functional correctness or portability risks.

## Findings

### Critical
1. `--dry-run` mutates files in CLI flows (`add`, `update`, `remove`)
- Files:
  - `tooling/jskit-cli/src/server/index.js` (around lines 1892-1945, 2841-2864, 2897-2917, 2973-3031)
- Why this is a slop marker:
  - Command intent and behavior diverge.
  - Mutation logic is spread across helpers before dry-run gating.
  - This is classic copy/paste command growth without invariant enforcement.

### High
2. API contract drift between versioned and unversioned auth endpoints
- Files:
  - `packages/access-core/src/lib/authApi.js` (hardcoded `/api/*`)
  - `packages/http-client-runtime/src/lib/client.js` (default CSRF session path `/api/session`)
  - `packages/auth-web/src/server/routes/authRoutes.js` (registers `/api/*` routes)
  - `packages/auth-web/src/client/composables/useDefaultLoginView.js` (uses `/api/*`)
  - `packages/auth-web/src/client/runtime/useSignOut.js` (mixes `/api/logout` and `/api/logout`)
- Why this is a slop marker:
  - Multiple “truths” for one contract.
  - Behavior depends on which helper path is used.

3. Contradictory client-route registration systems
- Files:
  - `packages/auth-web/src/client/routes/registerClientRoutes.js` (`componentPath` route model)
  - `packages/kernel/client/moduleBootstrap.js` (expects `module.clientRoutes` with `component`)
  - `packages/auth-web/src/client/index.js` (exports `registerClientRoutes`, no `clientRoutes`)
  - `packages/kernel/shared/surface/runtime.js` (still supports legacy `registerClientRoutes` pattern)
- Why this is a slop marker:
  - Two overlapping architectures are both “live”.
  - New modules can silently wire to the wrong system.

4. Template path traversal risk in `create-app --template`
- File:
  - `tooling/create-app/src/server/index.js` (around lines 222-245, 300-334)
- Why this is a slop marker:
  - Path joining without strict containment check.
  - Indicates defensive boundary checks were skipped.

5. Resolved: base-shell script portability debt in create-app generator
- Status:
  - Removed local bootstrap/registry scripts from generated template.
  - Kept only clean, portable script surfaces in template output.

### Medium
6. Large exact clones in `auth-web` across runtime/template/api layers
- Files:
  - `packages/auth-web/src/client/runtime/authGuardRuntime.js`
  - `packages/auth-web/templates/src/runtime/authGuardRuntime.js`
  - `packages/auth-web/src/client/runtime/useSignOut.js`
  - `packages/auth-web/templates/src/runtime/useSignOut.js`
  - `packages/auth-web/src/client/runtime/authHttpClient.js`
  - `packages/auth-web/src/client/api/AuthHttpClient.js`
  - `packages/auth-web/templates/src/runtime/authHttpClient.js`
- Why this is a slop marker:
  - Same logic exists in multiple authoritative copies.
  - Bug/security fixes can drift.

7. Kernel route policy mapping duplicated in two registrars
- Files:
  - `packages/kernel/server/http/lib/kernel.js`
  - `packages/kernel/server/runtime/apiRouteRegistration.js`
- Why this is a slop marker:
  - One concept implemented twice with separate maintenance paths.

8. Descriptor resolution duplicated with opposite failure behavior
- Files:
  - `packages/kernel/client/vite/clientBootstrapPlugin.js` (silent fallback to empty)
  - `packages/kernel/server/platform/providerRuntime.js` (throws hard error)
- Why this is a slop marker:
  - Same discovery logic, contradictory failure policy.

9. Duplicate package-discovery logic in CLI vs catalog builder
- Files:
  - `tooling/jskit-cli/src/server/index.js`
  - `tooling/jskit-catalog/scripts/build-catalog.mjs`
- Why this is a slop marker:
  - Directory crawling rules can drift between tools.

10. Stage metadata drift in docs example system
- Files:
  - `docs/examples/03.real-app/README.md`
  - `docs/examples/03.real-app/package.descriptor.mjs`
  - `docs/examples/manifest.json`
- Why this is a slop marker:
  - Repeated stage definitions diverged (README/provider list vs manifest stage coverage).

11. Repeated normalization/rule logic across multiple stage files
- Files:
  - `docs/examples/03.real-app/src/server/services/ContactQualificationServiceStage3.js`
  - `docs/examples/03.real-app/src/server/providers/ContactProviderStage7.js`
  - `docs/examples/03.real-app/src/server/providers/ContactProviderStage9.js`
  - `docs/examples/03.real-app/src/server/providers/ContactProviderStage10.js`
- Why this is a slop marker:
  - Domain normalization duplicated across layers and stages.

### Low
12. Repeated small utility functions across files
- Examples:
  - `normalizeObject` / `toPositiveInteger` patterns duplicated in `packages/action-runtime-core/src/lib/realtimePublish.js` and `packages/action-runtime-core/src/lib/actionContributorHelpers.js`
  - `isRecord` duplicated in `packages/kernel/client/moduleBootstrap.js` and `packages/kernel/client/shellBootstrap.js`
- Why this is a slop marker:
  - Small fix requires multi-file edits; easy drift.

13. No-op provider wrappers that only forward metadata
- Examples:
  - `packages/fastify-auth-policy/src/client/providers/FastifyAuthPolicyClientProvider.js`
  - `packages/rbac-core/src/client/providers/RbacClientProvider.js`
  - `packages/auth-provider-supabase-core/src/server/providers/AuthProviderServiceProvider.js`
- Why this is a slop marker:
  - Abstraction count grows faster than behavioral value.

14. Monolithic CLI server file with mixed concerns
- File:
  - `tooling/jskit-cli/src/server/index.js` (~3200+ lines)
- Why this is a slop marker:
  - Parsing, discovery, rendering, mutations, dispatch all co-located.
  - Increased chance of hidden behavioral regressions and contract drift.

## Intentional vs Problematic Repetition

### Intentional (acceptable)
- Tutorial stage progression in `docs/examples/03.real-app` where duplication is used pedagogically.
- Minimal example scaffolding and descriptor skeleton repetition across docs examples.
- Declarative vs programmatic route tutorial pair intentionally mirroring structure.

### Problematic (should be treated as debt)
- Repeated contract constants/paths where mismatches already exist.
- Runtime/template duplicates that are both editable and expected to stay in sync manually.
- Parallel registration/discovery systems that are partially migrated and partially legacy.

## What Most Strongly “Gives Away” AI-Style Authoring
- Multiple near-identical implementations with slight drift instead of one canonical source.
- Coexistence of old/new patterns without a hard migration boundary.
- Verbose wrapper classes/providers with minimal behavior.
- Large monolithic files that accumulated features rather than enforcing module boundaries.
- Inconsistent failure modes for semantically identical operations.

## Prioritized Remediation Targets
1. Enforce dry-run invariants so *no write path can execute* under `--dry-run`.
2. Canonicalize auth route/version constants (`/api` vs `/api`) in one shared module.
3. Choose one client-route registration contract and deprecate/remove the other.
4. Collapse `auth-web` runtime/template/api clones to generated or shared sources.
5. Extract shared kernel policy mapping and descriptor resolution helpers.
6. Split `tooling/jskit-cli/src/server/index.js` into command modules plus shared services.

## Verification Notes
- This report is based on static analysis and targeted behavioral repros in tooling paths.
- Full test suite execution was not part of this audit.
