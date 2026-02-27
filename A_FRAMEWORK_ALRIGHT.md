# A_FRAMEWORK_ALRIGHT

## 1) Mission
Implement a package-first framework system across the entire monorepo so that:

1. Every installable unit defines its own behavior in a `package.descriptor.mjs`.
2. Bundles (currently called packs in CLI/files) are only curated sets of package IDs plus options.
3. `jskit` executes package-defined mutations, dependency changes, and file operations transactionally.
4. Bundle add/update/remove is deterministic, idempotent, and capability-safe.
5. By final cutover there are zero legacy compatibility layers.

This plan is designed to be executable PR-by-PR with explicit test gates and unambiguous pass/fail criteria.

---

## 2) Non-Negotiables

1. Package-owned behavior only.
2. Bundles never contain app-mutation logic.
3. No silent fallback behavior.
4. No legacy compatibility shims at end-state.
5. All writes are rollback-safe.
6. Capability requirements must be enforced both at mutation time and via `jskit doctor`.
7. Package IDs must remain npm-compatible (`@scope/name` accepted).
8. All destructive operations must be explainable and dry-runnable.

---

## 3) Scope Snapshot (Current Repo)

Monorepo package count: `83`.

Domain counts:

- `ai-agent`: 9
- `auth`: 5
- `billing`: 13
- `chat`: 7
- `communications`: 6
- `contracts`: 2
- `observability`: 3
- `operations`: 2
- `realtime`: 2
- `runtime`: 7
- `security`: 2
- `social`: 5
- `surface-routing`: 1
- `tooling`: 4
- `users`: 4
- `web`: 2
- `workspace`: 9

Current status: `jskit` core has the first implementation of package descriptors, bundle option resolution, transactional rollback, capability checks, and update reconciliation. This plan scales that system to all packages and formal bundle catalog creation.

---

## 4) End-State Architecture (Strict)

## 4.1 Concepts

1. **Package**
   A concrete feature/runtime/integration unit that owns:
   - dependency mutations,
   - app artifact mutations,
   - required/provided capabilities,
   - dependency graph edges,
   - optional prompts/options contract,
   - optional migration templates.

2. **Bundle**
   A convenience grouping of package IDs.
   - May define option schema and package selection rules.
   - May not define mutation side effects.

3. **App Lock (`.jskit/lock.json`)**
   Installation state source of truth.
   - installed bundles,
   - installed packages,
   - managed file hashes,
   - managed package.json/procfile ownership metadata.

4. **App Manifest (`app.manifest.*` later)**
   Declarative desired app composition (optional early; required later).

## 4.2 Hard Rules

1. Package descriptors are colocated with package code.
2. Descriptor dependency declarations and `package.json` dependencies must not drift.
3. Bundle execution order is dependency graph order, not descriptor array order.
4. Removal is reverse order, with shared-package protection.
5. `jskit update` reconciles old vs new package sets.
6. DB schema changes occur only via app scripts (`db:migrate`), not inside `jskit add/update` live DB calls.

---

## 5) Data Contract Freeze (Do First)

## 5.1 `package.descriptor.mjs` (v1)

Required fields:

1. `packageVersion: 1`
2. `packageId: "@jskit-ai/..."`
3. `version: "x.y.z"`
4. `dependsOn: string[]`
5. `capabilities.provides: string[]`
6. `capabilities.requires: string[]`
7. `mutations.dependencies.runtime: Record<string, string>`
8. `mutations.dependencies.dev: Record<string, string>`
9. `mutations.packageJson.scripts: Record<string, string>`
10. `mutations.procfile: Record<string, string>`
11. `mutations.files: Array<{ from, to }>`

Optional fields (add in stage 2/3):

1. `prompts`: prompt schema for interactive values.
2. `config`: environment/config file patch rules.
3. `migrations`: artifact ownership metadata (`migrations`, `seeds`, optional data fixtures).
4. `lifecycle`: hooks (`preApply`, `postApply`, `preRemove`, `postRemove`) only if deterministic and dry-run safe.

## 5.2 `pack.descriptor.mjs` (Bundle Descriptor v2)

Required fields:

1. `packVersion: 2`
2. `packId`
3. `version`
4. `options` schema
5. `packages: Array<string | { packageId, when? }>`

Restriction:

- No mutation data in pack descriptors.

## 5.3 Lockfile Contract

Keep lock version `2` for now; add optional fields only in backward-compatible shape during rollout.

Required invariants:

1. Every `installedPacks[packId].packageIds[*]` exists in `installedPackages` unless intentionally shared and externalized.
2. Every managed file hash matches disk or is flagged by doctor.
3. Every installed package capability requirement is satisfied.

---

## 6) CLI Contract (Target)

Required commands:

1. `jskit list`
2. `jskit add <bundleOrPackId> [--<option> <value>]`
3. `jskit update <bundleOrPackId> [--<option> <value>]`
4. `jskit update --all`
5. `jskit remove <bundleOrPackId>`
6. `jskit doctor`
7. `jskit add-package <packageId> [--<option> <value>]` (new)
8. `jskit update-package <packageId> [--<option> <value>]` (new)
9. `jskit remove-package <packageId>` (new)
10. `jskit explain <bundleOrPackageId>` (new)

Optional but recommended:

1. `jskit plan <command...>` alias for `--dry-run --json`.
2. `jskit bundle list` and `jskit package list` split views.

---

## 7) Program Stages (Watertight)

## Stage 0: Freeze + Program Setup

Goal:
- Establish guardrails so migration cannot regress silently.

Deliverables:

1. `docs/framework/DECISIONS.md` with frozen rules from sections 2-6.
2. `docs/framework/MIGRATION_TRACKER.md` table with 83 package rows.
3. CI job skeleton for descriptor lint and conformance tests.

Tests to add:

1. `test/framework/decisionGuard.test.mjs` checks required policy keys exist.
2. `test/framework/packageInventory.test.mjs` verifies tracked package count equals actual package count.

Passing means:

1. Tracker includes all 83 packages.
2. CI fails if any package is missing from tracker.
3. No code path introduced in this stage bypasses existing tests.

---

## Stage 1: Descriptor Schema and Tooling Hardening

Goal:
- Make descriptor validation strict and developer-friendly.

Deliverables:

1. Shared JSON schema or schema-like validation utilities:
   - `packages/tooling/jskit/src/schemas/packageDescriptor.mjs`
   - `packages/tooling/jskit/src/schemas/packDescriptor.mjs`
2. CLI command: `jskit lint-descriptors`.
3. Script: `scripts/framework/validate-descriptors.mjs`.

Tests to add:

1. Unit tests for valid descriptors.
2. Unit tests for each invalid case:
   - bad package ID,
   - unknown option values,
   - invalid relative paths,
   - duplicate package IDs,
   - descriptor version mismatch.
3. Golden error message snapshots.

Passing means:

1. 100% of descriptors currently in repo lint clean.
2. Invalid fixtures fail with precise error messages.
3. `npm run -w packages/tooling/jskit test` remains green.

---

## Stage 2: Package-First Operation Completion in `jskit`

Goal:
- Complete install/remove/update primitives at package granularity.

Deliverables:

1. Implement package-level commands:
   - `add-package`, `update-package`, `remove-package`.
2. Add prompt system:
   - interactive prompt fallback,
   - non-interactive requires explicit options.
3. Add transaction journal detail in JSON output.
4. Add strict conflict classes:
   - managed-file drift,
   - managed-script drift,
   - capability violation,
   - unresolved dependency.

Tests to add:

1. add-package/install-path test.
2. remove-package shared ownership test.
3. update-package reapply test.
4. prompt resolution tests (interactive and non-interactive).
5. rollback tests for each conflict class.

Passing means:

1. Package commands work without any bundle involvement.
2. All write operations are rollback-safe.
3. Failure in any package step restores previous on-disk state.

---

## Stage 3: Descriptor Scaffolding Automation

Goal:
- Eliminate manual descriptor bootstrapping toil for 83 packages.

Deliverables:

1. Script: `scripts/framework/generate-package-descriptor.mjs`.
2. Script: `scripts/framework/sync-descriptor-deps.mjs`.
3. Script: `scripts/framework/check-descriptor-drift.mjs`.

Rules:

1. Generated descriptor starts with empty mutation maps unless explicit package-owned artifacts are detected.
2. Drift checker compares:
   - descriptor runtime/dev deps vs package.json deps,
   - declared scripts vs required app-level scripts (if any),
   - declared files vs existing template paths.

Tests to add:

1. Generator snapshot tests.
2. Drift checker positive/negative fixtures.

Passing means:

1. Descriptor generation for all 83 packages succeeds.
2. Drift checker has zero false positives on current repo.

---

## Stage 4: Core Runtime Conversion Wave

Goal:
- Convert foundational runtime/tooling packages first.

Packages:

1. `@jskit-ai/jskit`
2. `@jskit-ai/create-app`
3. `@jskit-ai/app-scripts`
4. `@jskit-ai/config-eslint`
5. `@jskit-ai/module-framework-core`
6. `@jskit-ai/server-runtime-core`
7. `@jskit-ai/platform-server-runtime`
8. `@jskit-ai/action-runtime-core`
9. `@jskit-ai/runtime-env-core`
10. `@jskit-ai/health-fastify-adapter`
11. `@jskit-ai/web-runtime-core`
12. `@jskit-ai/http-client-runtime`
13. `@jskit-ai/http-contracts`
14. `@jskit-ai/realtime-contracts`
15. `@jskit-ai/surface-routing`

Deliverables:

1. Add `package.descriptor.mjs` to each package.
2. Add capability declarations for runtime expectations.
3. Add minimal bundle descriptors:
   - `core-shell`,
   - `web-shell`,
   - `api-foundations`.

Tests to add:

1. Boot test of starter app with `core-shell` only.
2. Boot test with `web-shell`.
3. Boot test with `api-foundations`.
4. Doctor passes for each shell.

Passing means:

1. New blank app can install and run each shell bundle.
2. `jskit remove <shell>` cleans all managed files.
3. No shell relies on hidden legacy imports.

---

## Stage 5: Infrastructure Capability Conversion Wave

Goal:
- Convert infrastructure providers and shared capabilities.

Packages:

1. `@jskit-ai/knex-mysql-core`
2. `@jskit-ai/realtime-server-socketio`
3. `@jskit-ai/realtime-client-runtime`
4. `@jskit-ai/redis-ops-core`
5. `@jskit-ai/retention-core`
6. `@jskit-ai/security-audit-core`
7. `@jskit-ai/security-audit-knex-mysql`

Also keep `jskit` internal db provider packages:

1. `@jskit-ai/db-mysql`
2. `@jskit-ai/db-postgres`

Deliverables:

1. Capability catalog file:
   - `docs/framework/CAPABILITIES.md`.
2. Provider bundles:
   - `db` (`mysql` or `postgres`),
   - `realtime`,
   - `ops-retention`,
   - `security-audit`.

Tests to add:

1. Capability graph tests for missing providers.
2. Provider-switch update tests (`mysql -> postgres`).
3. Drift test for copied migration files.
4. `db:migrate` smoke tests for both providers in temp apps.

Passing means:

1. Provider swap updates artifacts and dependencies correctly.
2. `doctor` reports violations if provider removed while dependents remain.
3. DB scripts execute successfully in test containers or mocked harness.

---

## Stage 6: Domain Wave A (Auth, Communications, Observability)

Goal:
- Convert cross-cutting business foundations.

Packages:

1. `@jskit-ai/access-core`
2. `@jskit-ai/auth-fastify-adapter`
3. `@jskit-ai/auth-provider-supabase-core`
4. `@jskit-ai/fastify-auth-policy`
5. `@jskit-ai/rbac-core`
6. `@jskit-ai/communications-contracts`
7. `@jskit-ai/communications-core`
8. `@jskit-ai/communications-fastify-adapter`
9. `@jskit-ai/communications-provider-core`
10. `@jskit-ai/email-core`
11. `@jskit-ai/sms-core`
12. `@jskit-ai/observability-core`
13. `@jskit-ai/observability-fastify-adapter`
14. `@jskit-ai/console-errors-client-element`

Bundles to create:

1. `auth-base`
2. `auth-supabase`
3. `communications-base`
4. `observability-base`

Tests to add:

1. Auth flow smoke tests via generated app.
2. Communications service registration tests.
3. Observability event route tests.
4. Client element mount tests where applicable.

Passing means:

1. Each bundle installs and boots in isolation where expected.
2. Combined install (`auth + observability + db`) passes doctor and boots.

---

## Stage 7: Domain Wave B (Chat, Social, Users)

Goal:
- Convert social interaction feature families.

Packages:

1. `@jskit-ai/chat-client-element`
2. `@jskit-ai/chat-client-runtime`
3. `@jskit-ai/chat-contracts`
4. `@jskit-ai/chat-core`
5. `@jskit-ai/chat-fastify-adapter`
6. `@jskit-ai/chat-knex-mysql`
7. `@jskit-ai/chat-storage-core`
8. `@jskit-ai/social-client-runtime`
9. `@jskit-ai/social-contracts`
10. `@jskit-ai/social-core`
11. `@jskit-ai/social-fastify-adapter`
12. `@jskit-ai/social-knex-mysql`
13. `@jskit-ai/members-admin-client-element`
14. `@jskit-ai/profile-client-element`
15. `@jskit-ai/user-profile-core`
16. `@jskit-ai/user-profile-knex-mysql`

Bundles to create:

1. `chat-base`
2. `social-base`
3. `users-profile`
4. `community-suite` (chat + social + users profile)

Tests to add:

1. End-to-end bundle install test for each bundle.
2. DB-dependent package checks (requires `db-provider`).
3. Client runtime integration tests against API endpoints.

Passing means:

1. Installing `community-suite` with db provider yields a functional chat/social/profile app shell.
2. Removing any sub-bundle properly reconciles shared packages.

---

## Stage 8: Domain Wave C (Workspace + Console)

Goal:
- Convert workspace management surface.

Packages:

1. `@jskit-ai/console-errors-fastify-adapter`
2. `@jskit-ai/console-fastify-adapter`
3. `@jskit-ai/settings-fastify-adapter`
4. `@jskit-ai/workspace-console-core`
5. `@jskit-ai/workspace-console-knex-mysql`
6. `@jskit-ai/workspace-console-service-core`
7. `@jskit-ai/workspace-fastify-adapter`
8. `@jskit-ai/workspace-knex-mysql`
9. `@jskit-ai/workspace-service-core`

Bundles to create:

1. `workspace-core`
2. `workspace-console`
3. `workspace-admin-suite`

Tests to add:

1. Route registration tests for workspace adapters.
2. Workspace DB package install/remove and migration artifact ownership tests.
3. Console UI mount contract tests.

Passing means:

1. `workspace-admin-suite` boots with db provider and auth base.
2. Package removals do not orphan managed files/scripts.

---

## Stage 9: Domain Wave D (AI Agent + Billing)

Goal:
- Convert highest complexity families last, after framework maturity.

Packages (AI Agent):

1. `@jskit-ai/assistant-client-element`
2. `@jskit-ai/assistant-client-runtime`
3. `@jskit-ai/assistant-contracts`
4. `@jskit-ai/assistant-core`
5. `@jskit-ai/assistant-fastify-adapter`
6. `@jskit-ai/assistant-provider-openai`
7. `@jskit-ai/assistant-transcript-explorer-client-element`
8. `@jskit-ai/assistant-transcripts-core`
9. `@jskit-ai/assistant-transcripts-knex-mysql`

Packages (Billing):

1. `@jskit-ai/billing-commerce-client-element`
2. `@jskit-ai/billing-console-admin-client-element`
3. `@jskit-ai/billing-core`
4. `@jskit-ai/billing-fastify-adapter`
5. `@jskit-ai/billing-knex-mysql`
6. `@jskit-ai/billing-plan-client-element`
7. `@jskit-ai/billing-provider-core`
8. `@jskit-ai/billing-provider-paddle`
9. `@jskit-ai/billing-provider-stripe`
10. `@jskit-ai/billing-service-core`
11. `@jskit-ai/billing-worker-core`
12. `@jskit-ai/entitlements-core`
13. `@jskit-ai/entitlements-knex-mysql`

Bundles to create:

1. `assistant-base`
2. `assistant-openai`
3. `billing-base`
4. `billing-stripe`
5. `billing-paddle`
6. `billing-worker`
7. `saas-full` (composed from stable base bundles)

Tests to add:

1. Provider-option tests for assistant/billing provider selection.
2. Billing webhook and reconciliation smoke tests.
3. Transcript persistence tests with db capability enforcement.
4. Full-stack `saas-full` composition test in generated app.

Passing means:

1. Provider swaps update packages cleanly.
2. Billing and assistant bundles can be installed independently and together.
3. `jskit doctor` remains clean in all supported bundle combinations.

---

## Stage 10: Bundle Catalog Finalization

Goal:
- Stabilize bundle library and ensure each bundle is deterministic.

Deliverables:

1. `packages/tooling/jskit/packs/*` complete bundle set.
2. `docs/framework/BUNDLES.md` with:
   - purpose,
   - included packages,
   - required capabilities,
   - optional options,
   - conflict notes.
3. `jskit list --json` enriched with bundle metadata.

Tests to add:

1. Bundle descriptor lint tests.
2. Every bundle add/update/remove lifecycle test.
3. Bundle conflict tests (intentional impossible combos).

Passing means:

1. Every bundle has at least one integration test.
2. Every bundle is removable without residue in a clean app.

---

## Stage 11: Create-App + Starter Integration

Goal:
- Make framework UX first-class for new users.

Deliverables:

1. Starter template remains minimal shell only.
2. `create-app` optionally prompts for initial bundle install.
3. Post-create guidance includes explicit `jskit add ...` commands.
4. Default Procfile remains minimal (`web: npm run start`) unless added packages manage release process line.

Tests to add:

1. Create-app non-interactive flow.
2. Create-app interactive flow with initial bundle selection.
3. Generated app smoke tests for:
   - shell only,
   - shell + db,
   - shell + db + auth.

Passing means:

1. New app starts without framework-internal app-local engines.
2. New app can progressively gain capabilities through `jskit add`.

---

## Stage 12: Hard Cut and Legacy Deletion

Goal:
- Remove all legacy module loading surfaces and compatibility paths.

Mandatory deletions:

1. Old module registries no longer used by descriptor pipeline.
2. Legacy config keys and fallback resolution paths.
3. Legacy app-local patch scripts replaced by package descriptors.

Verification tests:

1. `rg` policy checks for banned tokens.
2. Runtime composition tests that only use descriptor-driven assembly.
3. Upgrade tests from pre-cut branch to cutover branch with explicit migration path.

Passing means:

1. Zero references to legacy compatibility APIs in runtime code paths.
2. All required CI suites pass after deletion.
3. Release notes document breaking changes explicitly.

---

## 8) Bundle Catalog Proposal (Initial v1)

Use this as the first concrete bundle set to implement and validate.

1. `core-shell`
   - `@jskit-ai/module-framework-core`
   - `@jskit-ai/runtime-env-core`
   - `@jskit-ai/server-runtime-core`
   - `@jskit-ai/platform-server-runtime`
   - `@jskit-ai/action-runtime-core`
   - `@jskit-ai/health-fastify-adapter`

2. `web-shell`
   - `core-shell` packages
   - `@jskit-ai/web-runtime-core`
   - `@jskit-ai/http-client-runtime`
   - `@jskit-ai/surface-routing`

3. `api-foundations`
   - `core-shell` packages
   - `@jskit-ai/http-contracts`

4. `db` (option: `provider=mysql|postgres`)
   - `@jskit-ai/db-mysql` or `@jskit-ai/db-postgres`

5. `auth-base`
   - `@jskit-ai/access-core`
   - `@jskit-ai/rbac-core`
   - `@jskit-ai/fastify-auth-policy`
   - `@jskit-ai/auth-fastify-adapter`

6. `auth-supabase`
   - `auth-base` packages
   - `@jskit-ai/auth-provider-supabase-core`

7. `realtime`
   - `@jskit-ai/realtime-contracts`
   - `@jskit-ai/realtime-client-runtime`
   - `@jskit-ai/realtime-server-socketio`

8. `communications-base`
   - `@jskit-ai/communications-contracts`
   - `@jskit-ai/communications-provider-core`
   - `@jskit-ai/communications-core`
   - `@jskit-ai/communications-fastify-adapter`

9. `observability-base`
   - `@jskit-ai/observability-core`
   - `@jskit-ai/observability-fastify-adapter`
   - `@jskit-ai/console-errors-client-element`

10. `chat-base`
    - `@jskit-ai/chat-contracts`
    - `@jskit-ai/chat-core`
    - `@jskit-ai/chat-fastify-adapter`
    - `@jskit-ai/chat-client-runtime`
    - `@jskit-ai/chat-client-element`

11. `social-base`
    - `@jskit-ai/social-contracts`
    - `@jskit-ai/social-core`
    - `@jskit-ai/social-fastify-adapter`
    - `@jskit-ai/social-client-runtime`

12. `users-profile`
    - `@jskit-ai/user-profile-core`
    - `@jskit-ai/user-profile-knex-mysql`
    - `@jskit-ai/profile-client-element`
    - `@jskit-ai/members-admin-client-element`

13. `workspace-core`
    - `@jskit-ai/workspace-service-core`
    - `@jskit-ai/workspace-knex-mysql`
    - `@jskit-ai/workspace-fastify-adapter`

14. `workspace-console`
    - `@jskit-ai/workspace-console-core`
    - `@jskit-ai/workspace-console-knex-mysql`
    - `@jskit-ai/workspace-console-service-core`
    - `@jskit-ai/console-fastify-adapter`
    - `@jskit-ai/console-errors-fastify-adapter`
    - `@jskit-ai/settings-fastify-adapter`

15. `assistant-base`
    - `@jskit-ai/assistant-contracts`
    - `@jskit-ai/assistant-core`
    - `@jskit-ai/assistant-fastify-adapter`
    - `@jskit-ai/assistant-client-runtime`
    - `@jskit-ai/assistant-client-element`
    - `@jskit-ai/assistant-transcripts-core`
    - `@jskit-ai/assistant-transcript-explorer-client-element`

16. `assistant-openai`
    - `assistant-base` packages
    - `@jskit-ai/assistant-provider-openai`
    - `@jskit-ai/assistant-transcripts-knex-mysql`

17. `billing-base`
    - `@jskit-ai/billing-core`
    - `@jskit-ai/billing-provider-core`
    - `@jskit-ai/billing-service-core`
    - `@jskit-ai/billing-fastify-adapter`
    - `@jskit-ai/entitlements-core`
    - `@jskit-ai/entitlements-knex-mysql`
    - `@jskit-ai/billing-knex-mysql`
    - `@jskit-ai/billing-plan-client-element`
    - `@jskit-ai/billing-commerce-client-element`

18. `billing-stripe`
    - `billing-base` packages
    - `@jskit-ai/billing-provider-stripe`

19. `billing-paddle`
    - `billing-base` packages
    - `@jskit-ai/billing-provider-paddle`

20. `billing-worker`
    - `@jskit-ai/billing-worker-core`

21. `ops-retention`
    - `@jskit-ai/redis-ops-core`
    - `@jskit-ai/retention-core`

22. `security-audit`
    - `@jskit-ai/security-audit-core`
    - `@jskit-ai/security-audit-knex-mysql`

23. `saas-full`
    - curated composition from stable bundles after stages 0-11 are complete.

---

## 9) Package Migration Matrix (All 83)

Status legend:

- `P0` pending
- `P1` descriptor created
- `P2` tests added
- `P3` bundled and integration-validated

### ai-agent (9)

1. `@jskit-ai/assistant-client-element` - P0
2. `@jskit-ai/assistant-client-runtime` - P0
3. `@jskit-ai/assistant-contracts` - P0
4. `@jskit-ai/assistant-core` - P0
5. `@jskit-ai/assistant-fastify-adapter` - P0
6. `@jskit-ai/assistant-provider-openai` - P0
7. `@jskit-ai/assistant-transcript-explorer-client-element` - P0
8. `@jskit-ai/assistant-transcripts-core` - P0
9. `@jskit-ai/assistant-transcripts-knex-mysql` - P0

### auth (5)

1. `@jskit-ai/access-core` - P0
2. `@jskit-ai/auth-fastify-adapter` - P0
3. `@jskit-ai/auth-provider-supabase-core` - P0
4. `@jskit-ai/fastify-auth-policy` - P0
5. `@jskit-ai/rbac-core` - P0

### billing (13)

1. `@jskit-ai/billing-commerce-client-element` - P0
2. `@jskit-ai/billing-console-admin-client-element` - P0
3. `@jskit-ai/billing-core` - P0
4. `@jskit-ai/billing-fastify-adapter` - P0
5. `@jskit-ai/billing-knex-mysql` - P0
6. `@jskit-ai/billing-plan-client-element` - P0
7. `@jskit-ai/billing-provider-core` - P0
8. `@jskit-ai/billing-provider-paddle` - P0
9. `@jskit-ai/billing-provider-stripe` - P0
10. `@jskit-ai/billing-service-core` - P0
11. `@jskit-ai/billing-worker-core` - P0
12. `@jskit-ai/entitlements-core` - P0
13. `@jskit-ai/entitlements-knex-mysql` - P0

### chat (7)

1. `@jskit-ai/chat-client-element` - P0
2. `@jskit-ai/chat-client-runtime` - P0
3. `@jskit-ai/chat-contracts` - P0
4. `@jskit-ai/chat-core` - P0
5. `@jskit-ai/chat-fastify-adapter` - P0
6. `@jskit-ai/chat-knex-mysql` - P0
7. `@jskit-ai/chat-storage-core` - P0

### communications (6)

1. `@jskit-ai/communications-contracts` - P0
2. `@jskit-ai/communications-core` - P0
3. `@jskit-ai/communications-fastify-adapter` - P0
4. `@jskit-ai/communications-provider-core` - P0
5. `@jskit-ai/email-core` - P0
6. `@jskit-ai/sms-core` - P0

### contracts (2)

1. `@jskit-ai/http-contracts` - P0
2. `@jskit-ai/realtime-contracts` - P0

### observability (3)

1. `@jskit-ai/console-errors-client-element` - P0
2. `@jskit-ai/observability-core` - P0
3. `@jskit-ai/observability-fastify-adapter` - P0

### operations (2)

1. `@jskit-ai/redis-ops-core` - P0
2. `@jskit-ai/retention-core` - P0

### realtime (2)

1. `@jskit-ai/realtime-client-runtime` - P0
2. `@jskit-ai/realtime-server-socketio` - P0

### runtime (7)

1. `@jskit-ai/action-runtime-core` - P0
2. `@jskit-ai/health-fastify-adapter` - P0
3. `@jskit-ai/knex-mysql-core` - P0
4. `@jskit-ai/module-framework-core` - P0
5. `@jskit-ai/platform-server-runtime` - P0
6. `@jskit-ai/runtime-env-core` - P0
7. `@jskit-ai/server-runtime-core` - P0

### security (2)

1. `@jskit-ai/security-audit-core` - P0
2. `@jskit-ai/security-audit-knex-mysql` - P0

### social (5)

1. `@jskit-ai/social-client-runtime` - P0
2. `@jskit-ai/social-contracts` - P0
3. `@jskit-ai/social-core` - P0
4. `@jskit-ai/social-fastify-adapter` - P0
5. `@jskit-ai/social-knex-mysql` - P0

### surface-routing (1)

1. `@jskit-ai/surface-routing` - P0

### tooling (4)

1. `@jskit-ai/app-scripts` - P0
2. `@jskit-ai/config-eslint` - P0
3. `@jskit-ai/create-app` - P0
4. `@jskit-ai/jskit` - P0

### users (4)

1. `@jskit-ai/members-admin-client-element` - P0
2. `@jskit-ai/profile-client-element` - P0
3. `@jskit-ai/user-profile-core` - P0
4. `@jskit-ai/user-profile-knex-mysql` - P0

### web (2)

1. `@jskit-ai/http-client-runtime` - P0
2. `@jskit-ai/web-runtime-core` - P0

### workspace (9)

1. `@jskit-ai/console-errors-fastify-adapter` - P0
2. `@jskit-ai/console-fastify-adapter` - P0
3. `@jskit-ai/settings-fastify-adapter` - P0
4. `@jskit-ai/workspace-console-core` - P0
5. `@jskit-ai/workspace-console-knex-mysql` - P0
6. `@jskit-ai/workspace-console-service-core` - P0
7. `@jskit-ai/workspace-fastify-adapter` - P0
8. `@jskit-ai/workspace-knex-mysql` - P0
9. `@jskit-ai/workspace-service-core` - P0

---

## 10) Mandatory Test Strategy

## 10.1 Unit Layer

Must cover:

1. Descriptor validation.
2. Dependency graph ordering and cycle errors.
3. Capability requirement checks.
4. File hash ownership and conflict detection.
5. Prompt option resolution.

Passing means:

1. Every new function has direct unit tests.
2. Negative path tests exist for each validator and conflict class.

## 10.2 Integration Layer (CLI + Temp App)

Must cover:

1. Add bundle.
2. Update bundle (same options and changed options).
3. Remove bundle.
4. Add/remove package directly.
5. Provider swap reconciliation.
6. Rollback on conflict mid-operation.
7. `doctor` clean and violation scenarios.

Passing means:

1. Temp app ends in expected filesystem/package.json/lockfile state.
2. No partial writes after forced failures.

## 10.3 End-to-End Layer (Generated App)

Must cover:

1. `npx @jskit-ai/create-app ...` shell run.
2. Progressive installs:
   - `db`,
   - `auth`,
   - feature bundle.
3. App boots and core health endpoints respond.

Passing means:

1. Generated app setup succeeds without manual patching.
2. Required scripts run (`dev`, `server`, optional db scripts if db bundle installed).

## 10.4 Regression/Policy Layer

Must cover:

1. Legacy token scan.
2. Descriptor drift scan.
3. Bundle matrix smoke tests.

Passing means:

1. No banned token matches in active framework codepaths.
2. Matrix includes at least one install/remove test per bundle.

---

## 11) “No Legacy” Enforcement Plan

Create `docs/framework/NO_LEGACY_POLICY.md` and a test `tests/framework/no-legacy.guard.test.mjs`.

Guard categories:

1. Disallow legacy runtime composition APIs.
2. Disallow old manifest/config fallbacks.
3. Disallow dead compatibility adapters.

Enforcement mechanism:

1. Maintain explicit banned symbol/path list.
2. CI blocks merge on matches.
3. Any intentional exception must be in an allowlist file with expiry date.

Passing means:

1. Allowlist empty at final stage.
2. No production path calls legacy loaders.

---

## 12) PR Slicing Strategy (Recommended)

Keep each PR tight and reviewable.

1. PR-01: schema lint + descriptor validation + tracker.
2. PR-02: package-level CLI commands + transactions hardening.
3. PR-03: descriptor generator/drift tooling.
4. PR-04: core runtime wave package descriptors + shell bundles.
5. PR-05: infra capability wave + db/realtime/ops/security bundles.
6. PR-06: auth/communications/observability wave.
7. PR-07: chat/social/users wave.
8. PR-08: workspace wave.
9. PR-09: ai-agent wave.
10. PR-10: billing wave.
11. PR-11: create-app integration and UX docs.
12. PR-12: hard-cut legacy deletion + enforcement.

Per-PR minimum:

1. Updated tracker statuses.
2. Added/updated tests.
3. `doctor` checks where relevant.
4. clear migration notes in PR description.

---

## 13) Acceptance Criteria (Program-Level)

The program is complete only when all are true:

1. All 83 monorepo packages have `package.descriptor.mjs`.
2. All target bundles exist with descriptor-only composition logic.
3. `jskit add/update/remove` supports both bundles and individual packages.
4. Capability graph enforcement blocks invalid states.
5. Transaction rollback guarantees no partial app mutation on failure.
6. Starter app remains minimal and gains features progressively via `jskit`.
7. No legacy compatibility layers remain.
8. CI includes descriptor lint, drift check, unit, integration, and e2e suites.
9. Docs provide a clear user journey from empty shell to full app.

---

## 14) Execution Checklist

Use this list every time work resumes.

1. Confirm current stage and stage exit criteria.
2. Select package wave slice (max 5-12 packages per PR unless tooling-only).
3. Generate/update descriptors.
4. Add capability/dependency declarations.
5. Add/adjust bundle descriptors.
6. Add unit + integration tests.
7. Run required local suite.
8. Update tracker statuses.
9. Verify no-legacy guard is still green.
10. Commit with stage + wave reference.

---

## 15) Required Command Suite Per PR

Minimum commands before merge:

```bash
npm run -w packages/tooling/jskit test
npm run -w packages/tooling/create-app test
npm pack --dry-run -w packages/tooling/jskit
npm run test:architecture:client
npm run test:architecture:shared-ui
node ./scripts/framework/validate-descriptors.mjs
node ./scripts/framework/check-descriptor-drift.mjs
```

For waves touching runtime/app boot:

```bash
npm run app:create -- my-smoke-app --force
cd my-smoke-app
npm install
npx @jskit-ai/jskit add core-shell --no-install
npx @jskit-ai/jskit doctor
npm run server
```

Passing means:

1. All commands exit `0`.
2. No unexpected file drift after test runs.

---

## 16) Risk Register and Mitigations

1. **Risk:** Descriptor/package.json drift.
   - **Mitigation:** mandatory drift checker in CI.

2. **Risk:** Bundle over-coupling.
   - **Mitigation:** keep bundles thin, capability-driven, and composable.

3. **Risk:** Confusing provider selection UX.
   - **Mitigation:** strict option validation, `jskit explain`, interactive prompts.

4. **Risk:** Broken updates from option changes.
   - **Mitigation:** reconciliation tests for every provider-like bundle.

5. **Risk:** Hidden legacy code survives.
   - **Mitigation:** no-legacy guard with banned symbol scan and zero allowlist by end.

6. **Risk:** Large PRs become unreviewable.
   - **Mitigation:** wave slicing and mandatory tracker updates per PR.

---

## 17) Immediate Next Actions

1. Implement Stage 0 deliverables and commit.
2. Land Stage 1 descriptor linting and validation hardening.
3. Add Stage 2 package-level CLI commands.
4. Start Stage 3 generator/drift scripts.
5. Begin Stage 4 core runtime wave with full tests before moving to domain waves.
