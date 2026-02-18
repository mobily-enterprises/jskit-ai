# Code Review Report

## Critical

1. No new critical findings in this delta pass.

## High

1. **Title:** Non-atomic multi-write admin flows can leave partial workspace state
   - **Severity:** High
   - **Confidence:** High
   - **Category:** Reliability
   - **Evidence:** `services/workspaceAdminService.js:190`, `services/workspaceAdminService.js:229`, `services/workspaceAdminService.js:444`, `services/workspaceAdminService.js:445`, `services/workspaceAdminService.js:448`
   - **Why it matters:** `updateWorkspaceSettings` and invite acceptance each perform multiple dependent writes without a transaction. A mid-sequence DB error can leave inconsistent state (example: membership activated but invite still pending; workspace name updated but settings patch not applied).
   - **Minimal fix:** Wrap each multi-write flow in a single DB transaction and route repository calls through that transaction context.
   - **Verification:** Add integration tests that inject a failure between writes and assert full rollback (no partial row changes).

## Medium

1. **Title:** N+1 membership lookups in pending-invite filtering paths
   - **Severity:** Medium
   - **Confidence:** High
   - **Category:** Performance
   - **Evidence:** `services/workspaceService.js:239`, `services/workspaceAdminService.js:390`, `repositories/workspaceMembershipsRepository.js:43`
   - **Why it matters:** For N invites, code runs N membership queries. At scale this increases latency and DB load sharply.
   - **Minimal fix:** Add repository method to fetch memberships for `(userId, workspaceIds[])` in one query; filter in memory.
   - **Verification:** Add query-count assertion test for 100 invites (expect O(1) membership queries, not O(N)).

2. **Title:** Workspace access mapping performs per-workspace settings fetches
   - **Severity:** Medium
   - **Confidence:** High
   - **Category:** Performance
   - **Evidence:** `services/workspaceService.js:53`, `services/workspaceService.js:119`, `services/workspaceService.js:249`, `services/workspaceService.js:342`
   - **Why it matters:** Access resolution for users in many workspaces triggers one settings lookup per workspace, creating avoidable DB round-trips.
   - **Minimal fix:** Batch-load workspace settings for all candidate workspace IDs before access evaluation.
   - **Verification:** Benchmark/bootstrap test with many workspaces, asserting reduced DB query count and lower p95 latency.

3. **Title:** Read endpoints perform write-heavy invite expiry sweep on each call
   - **Severity:** Medium
   - **Confidence:** High
   - **Category:** Reliability
   - **Evidence:** `services/workspaceService.js:229`, `services/workspaceAdminService.js:292`, `services/workspaceAdminService.js:382`, `services/workspaceAdminService.js:419`, `repositories/workspaceInvitesRepository.js:237`
   - **Why it matters:** Listing/reading invites triggers `UPDATE ... WHERE status='pending' AND expires_at<=now` every request, causing write amplification and lock pressure under traffic.
   - **Minimal fix:** Move expiry transition to scheduled job, or run lazily with coarse throttling; keep read queries filtering by `expires_at`.
   - **Verification:** Load test invite-list endpoints and compare write TPS/latency before vs after.

4. **Title:** API client retries all unsafe 403 responses, not just CSRF failures
   - **Severity:** Medium
   - **Confidence:** High
   - **Category:** Reliability
   - **Evidence:** `src/services/api.js:151`, `src/services/api.js:152`, `src/services/api.js:155`
   - **Why it matters:** Permission/business-rule 403s get retried once automatically. For non-idempotent operations this can duplicate side effects or hide real authorization failures.
   - **Minimal fix:** Retry only when response includes explicit CSRF error code (add machine-readable code from backend for CSRF failures).
   - **Verification:** Unit tests: (a) CSRF 403 retries once, (b) non-CSRF 403 does not retry.

5. **Title:** Workspace-settings query cache keys are not workspace-scoped
   - **Severity:** Medium
   - **Confidence:** Medium
   - **Category:** Consistency
   - **Evidence:** `src/views/workspace-settings/useWorkspaceSettingsView.js:7`, `src/views/workspace-settings/useWorkspaceSettingsView.js:8`, `src/views/workspace-settings/useWorkspaceSettingsView.js:9`, `src/views/workspace-settings/useWorkspaceSettingsView.js:118`, `src/views/workspace-settings/useWorkspaceSettingsView.js:290`
   - **Why it matters:** Switching workspaces can reuse stale cached settings/members/invites from another workspace before refetch, producing cross-workspace UI inconsistency.
   - **Minimal fix:** Include active workspace slug/id in all workspace-admin query keys and `setQueryData` calls.
   - **Verification:** Component test that switches A -> B and asserts no stale A data is rendered for B.

6. **Title:** Store can auto-select an inaccessible workspace and mark app as having active workspace
   - **Severity:** Medium
   - **Confidence:** High
   - **Category:** Bug
   - **Evidence:** `src/stores/workspaceStore.js:172`, `src/stores/workspaceStore.js:224`, `src/stores/workspaceStore.js:232`, `src/routerGuards.js:57`
   - **Why it matters:** If bootstrap returns one workspace with `isAccessible=false` and no selected workspace, store still sets `activeWorkspace`; guards then route as if workspace is valid.
   - **Minimal fix:** Only apply single-workspace fallback when `isAccessible===true`; optionally make `hasActiveWorkspace` require accessibility.
   - **Verification:** Unit tests for `applyBootstrap` + guard behavior with single inaccessible workspace.

## Low

1. **Title:** Invite `token_hash` is generated/stored but not used in acceptance flow
   - **Severity:** Low
   - **Confidence:** High
   - **Category:** Maintainability
   - **Evidence:** `services/workspaceAdminService.js:151`, `services/workspaceAdminService.js:345`, `services/workspaceAdminService.js:420`, `migrations/20260217120300_create_workspace_invites.cjs:7`, `repositories/workspaceInvitesRepository.js:76`
   - **Why it matters:** Dead security-adjacent field creates false assumptions and unnecessary schema/index complexity.
   - **Minimal fix:** Either implement token-based invite redemption using the hash, or remove `token_hash` and related generation/indexing.
   - **Verification:** Add tests for chosen model (token redemption) or migration/service tests confirming field removal.

2. **Title:** README API contract list is out of sync with actual route surface
   - **Severity:** Low
   - **Confidence:** High
   - **Category:** Consistency
   - **Evidence:** `README.md:198`, `README.md:211`, `routes/apiRoutes.js:331`, `routes/apiRoutes.js:364`, `routes/apiRoutes.js:510`, `routes/apiRoutes.js:651`
   - **Why it matters:** Incomplete docs increase onboarding/debug time and create client integration mistakes.
   - **Minimal fix:** Generate endpoint inventory from OpenAPI/route config and treat docs as generated artifact.
   - **Verification:** CI check that fails when documented endpoint list diverges from generated route list.

## Top 15 Quick Wins

1. Add transaction wrapper for invite acceptance flow.
2. Add transaction wrapper for workspace settings update flow.
3. Introduce batch membership lookup by `(userId, workspaceIds[])`.
4. Batch-load workspace settings during workspace context resolution.
5. Stop mutating invite expiry state on every read endpoint call.
6. Add machine-readable CSRF error code in API error payload.
7. Restrict client retry logic to CSRF-coded 403 only.
8. Scope workspace admin query keys by workspace slug/id.
9. Guard single-workspace fallback with `isAccessible`.
10. Update `hasActiveWorkspace` semantics to include accessibility.
11. Decide and implement/remove invite token hash model.
12. Add query-count assertions for invite and workspace bootstrap paths.
13. Add failure-injection integration tests for multi-write service methods.
14. Auto-generate README API contract section from OpenAPI.
15. Add perf budget checks for workspace bootstrap under high workspace counts.

## Strategic Refactors

1. Introduce a service-level Unit of Work pattern so multi-repository operations are transaction-safe by default.
2. Build a workspace context hydrator that batch-fetches memberships, settings, and permissions in one data access pass.
3. Standardize backend error contracts with stable code fields to support deterministic frontend behavior.
4. Move query-key construction into a shared factory keyed by tenant/workspace context.
5. Generate API docs/contracts from route schemas to eliminate manual drift.

## Test Plan (Highest ROI First)

1. Transaction rollback tests for `respondToPendingInvite` and `updateWorkspaceSettings` with forced mid-flow failures.
2. Concurrency/idempotency tests for duplicate invite-accept attempts.
3. Unit tests for API retry policy (CSRF vs non-CSRF 403 behavior).
4. Store + router guard tests for inaccessible single-workspace bootstrap payload.
5. Vue Query cache-isolation tests across workspace switches.
6. Query-count regression tests for pending invite lists and bootstrap workspace mapping.
7. Docs drift CI test comparing generated endpoint inventory with README contract section.

## Code Consistency Matrix

| Dimension      | Current state                                                                           | Evidence                                                                                            | Target consistency                                                             |
| -------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Naming         | Mostly consistent; one misleading field (`token_hash`) implies unused token flow.       | `services/workspaceAdminService.js:151`, `migrations/20260217120300_create_workspace_invites.cjs:7` | Align field names with actual runtime behavior, or implement intended flow.    |
| Error handling | Backend lacks machine-readable CSRF distinction; frontend infers from status only.      | `plugins/auth.js:85`, `server.js:351`, `src/services/api.js:152`                                    | Uniform error code values and client policy keyed on code.                     |
| Validation     | Input validation is generally strong in services/controllers.                           | `services/userSettingsService.js:68`                                                                | Keep current approach; extend to behavior contracts (retry/idempotency cases). |
| Logging        | No targeted telemetry around query amplification or expiry sweep writes.                | `repositories/workspaceInvitesRepository.js:237`                                                    | Add structured metrics/logging for high-frequency DB paths.                    |
| Async patterns | Several sequential multi-write async flows without transaction boundaries.              | `services/workspaceAdminService.js:444`, `services/workspaceAdminService.js:445`                    | Transactional async orchestration for dependent writes.                        |
| Test patterns  | Functional tests exist, but missing high-value concurrency/rollback/query-count checks. | Gaps around cited files above.                                                                      | Add reliability/perf contract tests as first-class CI gates.                   |

## Open Questions / Assumptions

1. Assumption: This report intentionally excludes all items already in `REPORT_SECURITY.txt`.
2. Is invite acceptance intentionally `authenticated email + inviteId` only, or was token-based redemption intended?
3. What is the expected upper bound of workspaces/invites per user (to size batching/perf fixes correctly)?
4. Do you want expired-invite status materialized immediately, or is eventual consistency (scheduled sweep) acceptable?
5. Should all 403 responses be non-retriable by default client policy unless explicitly marked retriable?
