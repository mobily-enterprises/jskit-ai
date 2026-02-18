REPORT_SECURITY.txt


  Critical

  X 1. Shared mutable Supabase session state across requests can cause cross-user
     account actions.
     Severity: Critical
     Confidence: High
     Evidence: services/authService.js:73, services/authService.js:86, services/
     authService.js:175, services/authService.js:184, services/
     authService.js:242, services/auth/lib/accountFlows.js:196, services/auth/
     lib/accountFlows.js:201, services/auth/lib/passwordSecurityFlows.js:147,
     services/auth/lib/passwordSecurityFlows.js:173, services/auth/lib/
     oauthFlows.js:68, services/auth/lib/oauthFlows.js:83, services/auth/lib/
     oauthFlows.js:154, services/auth/lib/oauthFlows.js:175
     Why it matters: A singleton Supabase client is reused server-wide, but
     request handlers call setSession(...) and then stateful methods
     (updateUser, linkIdentity, unlinkIdentity, signOut, getUser() without
     token). Under concurrent traffic, one request can overwrite client auth
     state for another request, causing wrong-user updates or identity
     operations.
     Minimal fix: Stop using a shared mutable auth client for request-scoped
     auth. Create a per-request client (or fully stateless calls using explicit
     access token), and remove stateful calls that depend on global in-memory
     session.

  High

  X 2. Dependency supply-chain risk: Knex is pinned to GitHub master tarball.
     Severity: High
     Confidence: High
     Evidence: package.json:58
     Why it matters: Builds are non-reproducible and can change without review.
     A compromised upstream branch or breaking commit can silently affect
     production.
     Minimal fix: Pin to a published semver release or immutable commit SHA with
     lockfile integrity verification.

  3. Personal-workspace creation is non-atomic and not uniqueness-enforced,
     risking duplicate “personal” workspaces and partial state.
     Severity: High
     Confidence: High
     Evidence: services/workspaceService.js:66, services/workspaceService.js:77,
     services/workspaceService.js:78, services/workspaceService.js:80,
     migrations/20260217120000_create_workspaces.cjs:4,
     migrations/20260217120000_create_workspaces.cjs:12, repositories/
     workspaceMembershipsRepository.js:69, repositories/
     workspaceSettingsRepository.js:57
     Why it matters: Concurrent requests can race between read/check/insert
     across workspaces, memberships, settings, and user settings. Failures mid-
     sequence can leave inconsistent tenant state.
     Minimal fix: Wrap “ensure personal workspace” flow in a DB transaction with
     retry-on-duplicate behavior; add DB-level invariant enforcement strategy
     for one personal workspace per owner.

  4. Invite creation has race conditions allowing duplicate pending invites.
     Severity: High
     Confidence: High
     Evidence: services/workspaceAdminService.js:336, services/
     workspaceAdminService.js:341,
     migrations/20260217120300_create_workspace_invites.cjs:18
     Why it matters: Two parallel create-invite requests can both pass the pre-
     check and insert duplicates, leading to bad UX and inconsistent invitation
     lifecycle.
     Minimal fix: Add DB-enforced uniqueness for active/pending invite invariant
     and use atomic insert/upsert in a transaction.

  Medium

  5. End-to-end test suite is currently broken (3/3 failing), reducing release
     confidence.
     Severity: Medium
     Confidence: High
     Evidence: npm run test:e2e currently fails all tests; test files at tests/
     e2e/auth-history.spec.js:60, tests/e2e/auth-history.spec.js:137, tests/e2e/
     auth-history.spec.js:216
     Why it matters: Critical flows (login/calculate/history) are no longer
     validated in CI.
     Minimal fix: Repair selectors and mocks; fail CI on e2e regressions once
     green.


  6. E2E selector fragility: duplicate accessible “Sign in” button names cause
     strict-mode collisions.
     Severity: Medium
     Confidence: High
     Evidence: src/views/login/LoginView.vue:22, src/views/login/
     LoginView.vue:151, tests/e2e/auth-history.spec.js:60
     Why it matters: Tests break on harmless UI changes; this hides real
     regressions and wastes maintenance time.
     Minimal fix: Add stable data-testid on primary actions and update
     Playwright selectors.


  7. E2E tests mock old auth/session flow and omit /api/bootstrap, so app boot
     path is not represented.
     Severity: Medium
     Confidence: High
     Evidence: src/bootstrapRuntime.js:96, tests/e2e/auth-history.spec.js:22,
     tests/e2e/auth-history.spec.js:74, tests/e2e/auth-history.spec.js:151
     Why it matters: Test assumptions drifted from runtime architecture; tests
     fail or provide false signals.
     Minimal fix: Mock /api/bootstrap consistently (or run against seeded
     backend) and keep route interception aligned with app boot behavior.



  8. test:coverage:full is practically non-passable due backend per-file 100%
     thresholds, making the gate unusable.
     Severity: Medium
     Confidence: High
     Evidence: .c8rc.json:3, .c8rc.json:4, .c8rc.json:5, .c8rc.json:6, .c8rc.jso
     n:7, .c8rc.json:8, package.json:29
     Why it matters: Teams either ignore the script or block constantly; both
     outcomes reduce quality signal.
     Minimal fix: Set realistic required thresholds and keep 100% as
     aspirational/reporting-only job.
  9. Formatting gate currently fails on many files, introducing continuous
     tooling noise.
     Severity: Medium
     Confidence: High
     Evidence: npm run format:check reports 69 files needing formatting.
     Why it matters: Noisy gates reduce developer trust and hide meaningful
     failures.
     Minimal fix: Run one repo-wide format sweep and enforce formatting on
     changed files in CI/pre-commit.
=================================================================
  10. No type-check script exists.
     Severity: Medium
     Confidence: High
     Evidence: package.json scripts list has no typecheck entry (tool check
     returned <no typecheck script>).
     Why it matters: Runtime-only validation misses refactor-time contract
     breakage in a large JS codebase.
     Minimal fix: Add typecheck (e.g., tsc --noEmit with checkJs, or migrate
     critical modules to TS).
================================================================
  11. Migration rollback for workspace backfill is destructive and loses linkage
     data.
     Severity: Medium
     Confidence: High
     Evidence:
     migrations/20260217120600_backfill_personal_workspaces_and_workspace_ids.cj
     s:148,
     migrations/20260217120600_backfill_personal_workspaces_and_workspace_ids.cj
     s:149,
     migrations/20260217120600_backfill_personal_workspaces_and_workspace_ids.cj
     s:150
     Why it matters: Rolling back erases all calculation_logs.workspace_id,
     harming auditability and recovery.
     Minimal fix: Mark migration irreversible or maintain reversible mapping
     state.

  Low

  12. Repeated helper logic increases drift risk.
     Severity: Low
     Confidence: High
     Evidence: shared/auth/utils.js:1, services/workspace/lib/
     workspaceHelpers.js:56, services/workspace-admin/lib/
     workspaceAdminHelpers.js:9, services/auth/lib/authServiceHelpers.js:378,
     src/utils/oauthCallback.js:67
     Why it matters: Validation and normalization behavior can diverge between
     modules over time.
     Minimal fix: Consolidate shared normalization/validation primitives into a
     single shared module.

  Top 10 quick wins

  1. Replace singleton Supabase client usage with request-scoped clients
     immediately.
  2. Pin knex to immutable version/SHA and regenerate lockfile.
  3. Add transaction boundaries to personal-workspace ensure flow.
  4. Add DB-backed uniqueness for pending invites and switch to atomic insert/
     upsert.
  5. Fix Playwright selectors with data-testid for primary actions.
  6. Update e2e mocks to include /api/bootstrap and current auth boot flow.
  7. Rebaseline backend coverage thresholds to realistic enforceable values.
  8. Run one-time prettier --write and enforce on changed files.
  9. Add a typecheck script and wire it into CI.
  10. Mark destructive migrations as irreversible or make down migrations data-
     safe.

  Strategic refactors

  1. Introduce an auth adapter layer that is explicitly stateless at request
     boundaries.
  2. Move workspace lifecycle operations into transactional repository/unit-of-
     work APIs.
  3. Unify validation and normalization into shared cross-layer modules (server/
     client).
  4. Adopt a test architecture contract: fast unit tests, deterministic
     integration tests, stable e2e selectors.
  5. Add dependency governance (pinning policy, update cadence, automated SBOM/
     vuln checks).

  Test plan

  1. Add concurrency tests proving no cross-request auth context leakage
     (parallel password/profile/link operations across users).
  2. Add race-condition tests for personal workspace creation and invite
     creation under parallel requests.
  3. Add integration tests asserting transaction rollback behavior on partial
     failures in workspace setup.
  4. Add migration tests for rollback safety of workspace backfill.
  5. Add e2e tests with stable selectors and bootstrap-aware API mocking.
  6. Add CI test that test:coverage:full policy is intentionally configured and
     achievable.

  Open questions/assumptions

  1. Are you running multiple app instances behind a load balancer? If yes, in-
     memory rate limiting is materially weaker.
  2. Is test:coverage intended as a required CI gate today, or only a progress
     target?
  3. Is invite acceptance intentionally account+email based (without invite
     secret token flow)?
  4. Are you open to incremental TypeScript adoption for auth/workspace layers
     first?
