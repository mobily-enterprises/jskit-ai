## Broken things

### [06-ISSUE-001] Assistant-tool arguments can override workspace/user context and cross tenant boundaries
- Severity: P0
- Confidence: high
- Contract area: tenancy
- First seen: 2026-02-26
- Last seen: 2026-02-26
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/ai/lib/tools/actionTools.js:307
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/projects.contributor.js:49
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/projects.contributor.js:334
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/deg2radHistory.contributor.js:42
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/deg2radHistory.contributor.js:147
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/projects/service.js:125
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/history/service.js:61
- Why this is broken:
  - Tool calls pass `args` directly into action input, and contributor resolvers prefer `input.workspace`/`input.user` over authenticated context. Runtime validation showed injected tool args (`workspace.id=999`, `user.id=777`) overriding context (`workspace.id=17`, `actor.id=42`) and being used by downstream services. This is a tenant-isolation and principal-integrity break for assistant-tool capable actions.
- Suggested fix:
  - Make contributor identity/workspace resolution context-authoritative (`request/context` first) and ignore `input.user`/`input.workspace` for `api` and `assistant_tool` channels. If internal impersonation is required, gate it behind explicit internal-only flags and dedicated actions.
- Suggested tests:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/projectsActionContributor.test.js
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/realtimeActionContributorPublish.test.js
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/actionRegistry.test.js
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/assistantToolContextIntegrity.test.js

### [06-ISSUE-002] Billing idempotency adapter remains noop even when billing idempotency service is available
- Severity: P1
- Confidence: high
- Contract area: action-runtime
- First seen: 2026-02-26
- Last seen: 2026-02-26
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/idempotencyAdapters.js:6
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/idempotencyAdapters.js:15
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/idempotencyAdapters.js:19
- Why this is broken:
  - The adapter checks for `workspace.billing.*` but still delegates to noop logic and never calls `billingIdempotencyService`. Runtime validation confirmed `claimOrReplay` calls stayed at `0` for a billing action ID, so replay/claim persistence is not active where billing idempotency is expected.
- Suggested fix:
  - Wire `claimOrReplay`, `markSucceeded`, and `markFailed` to `billingIdempotencyService` for billing action IDs, preserving noop behavior only for non-billing actions.
- Suggested tests:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/actionIdempotencyAdapters.test.js
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/actionRegistry.test.js
- Related:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/01-server-skeleton-runtime-composition.report.md [01-ISSUE-002]
- Linked status:
  - 2026-02-26: Report `01-server-skeleton-runtime-composition` [01-ISSUE-002] moved to `Fixed things` after removing misleading billing-idempotency injection and codifying explicit noop adapter ownership in:
    - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/idempotencyAdapters.js
    - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/createActionRegistry.js

### [06-ISSUE-003] Action-runtime docs drift from mounted contributor composition
- Severity: P3
- Confidence: high
- Contract area: docs
- First seen: 2026-02-26
- Last seen: 2026-02-26
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributorManifest.js:38
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributorManifest.js:51
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/flows/04.action-runtime.md:18
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/architecture/action-runtime-and-contributors.md:100
- Why this is broken:
  - Runtime composition currently mounts `social` and `alerts` contributors, but required docs still present a partial contributor list. This creates review/onboarding drift against the actual action registry.
- Suggested fix:
  - Update both required docs to reflect current contributor mount set and keep examples synchronized with `server/runtime/actions/contributorManifest.js`.
- Suggested tests:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/actionRegistry.test.js

## Fixed things

## Won't fix things
