## Broken things

### [03-ISSUE-002] Auth helper tests target app-local auth copies instead of the runtime-wired package seam
- Status: OPEN
- Severity: P3
- Confidence: high
- Contract area: tests
- First seen: 2026-02-26
- Last seen: 2026-02-26
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/services.js:1
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/services.js:605
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/auth/service.js:1
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/authRequestScopedSupabaseClient.test.js:5
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/oauthFlowsAndAuthMethods.test.js:5
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/authServiceHelpersBranches.test.js:5
- Why this is broken:
  - Runtime auth/session composition is wired to `@jskit-ai/auth-provider-supabase-core`, while several auth helper tests execute app-local duplicate implementations under `server/modules/auth/lib`. This creates drift risk where local helper tests can pass while runtime package behavior changes independently.
- Suggested fix:
  - Consolidate to one implementation seam: either remove app-local auth helper copies or move helper tests to target the package seam used by runtime composition.
- Suggested tests:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/authService.test.js
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/authRequestScopedSupabaseClient.test.js
- Status in this pass:
  - No code changes were applied yet. The issue remains open and still needs a consolidation pass.
- Related:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/04-workspace-surface-policy-core.report.md [04-ISSUE-002]

### [03-ISSUE-003] OAuth callback error descriptions are echoed directly to API callers
- Status: OPEN
- Severity: P2
- Confidence: high
- Contract area: security
- First seen: 2026-02-26
- Last seen: 2026-02-26
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/services.js:1
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/services.js:605
  - /home/merc/Development/current/jskit-ai/packages/auth/auth-provider-supabase-core/src/lib/authInputParsers.js:198
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/authServiceHelpersBranches.test.js:188
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/flows/14.error-handling.md:78
- Why this is broken:
  - `mapOAuthCallbackError` formats `OAuth sign-in failed: ${description}` from callback payload values. That returns provider-supplied or user-controlled `errorDescription` text directly in API error messages, which violates the safe error contract and can leak provider/internal details.
- Suggested fix:
  - Return a stable generic message for non-cancelled OAuth callback failures (for example `OAuth sign-in failed.`), and keep raw callback detail only in server-side telemetry/logging.
- Suggested tests:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/authService.test.js
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/authServiceHelpersBranches.test.js
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/oauthFlowsAndAuthMethods.test.js
- Status in this pass:
  - No code changes were applied yet. The issue remains open.
- Related:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/03-auth-provider-session-pipeline.report.md [03-ISSUE-001]

## Fixed things

### [03-ISSUE-001] Unmapped auth-provider client errors are returned verbatim to API callers
- Fixed on: 2026-02-26
- How fixed:
  - Removed the fallback branch that echoed unmapped provider 4xx error messages and now return a generic safe message while preserving mapped statuses.
  - Applied the same change to both the runtime auth-provider package mapper and the app-local mirror to keep behavior aligned.
  - Updated `mapAuthError` fallback handling to stop returning provider/raw 4xx message strings and instead return `Authentication request could not be processed.` for unmapped 4xx errors.
  - Code changes were applied in:
    - `/home/merc/Development/current/jskit-ai/packages/auth/auth-provider-supabase-core/src/lib/authErrorMappers.js`
    - `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/auth/lib/authErrorMappers.js`
- Validation:
  - `npm test -- tests/authService.test.js` (pass, 19 passed / 0 failed)
  - `npm test -- tests/authServiceHelpersBranches.test.js` (pass, 4 passed / 0 failed)
  - `npm test -- tests/authPermissions.test.js` (pass, 13 passed / 0 failed)
- Evidence:
  - /home/merc/Development/current/jskit-ai/packages/auth/auth-provider-supabase-core/src/lib/authErrorMappers.js:97
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/auth/lib/authErrorMappers.js:97

## Won't fix things
