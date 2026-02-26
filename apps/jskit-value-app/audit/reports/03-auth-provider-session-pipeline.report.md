## Broken things

## Fixed things

### [03-ISSUE-003] OAuth callback error descriptions are echoed directly to API callers
- Fixed on: 2026-02-26
- How fixed:
  - Removed callback-description echoing from OAuth callback error mapping and now always return stable client-safe messages.
  - Kept `access_denied` mapped to `OAuth sign-in was cancelled.` and map all other callback failures to `OAuth sign-in failed.`.
  - Applied the same mapper hardening to both the runtime package seam and the app-local mirror to prevent seam drift.
  - Updated auth tests to assert the generic message path and added an explicit regression assertion that untrusted callback text is not reflected in returned messages.
  - Code changes were applied in:
    - `/home/merc/Development/current/jskit-ai/packages/auth/auth-provider-supabase-core/src/lib/authInputParsers.js`
    - `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/auth/lib/authInputParsers.js`
    - `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/authService.test.js`
    - `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/authServiceHelpersBranches.test.js`
- Validation:
  - `npm test -- tests/authService.test.js tests/authServiceHelpersBranches.test.js tests/oauthFlowsAndAuthMethods.test.js tests/authTestSeamContract.test.js` (pass, 30 passed / 0 failed)
- Evidence:
  - /home/merc/Development/current/jskit-ai/packages/auth/auth-provider-supabase-core/src/lib/authInputParsers.js:187
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/auth/lib/authInputParsers.js:187
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/authService.test.js:327
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/authServiceHelpersBranches.test.js:187
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/flows/14.error-handling.md:78
- Related:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/03-auth-provider-session-pipeline.report.md [03-ISSUE-001]

### [03-ISSUE-002] Auth helper tests target app-local auth copies instead of the runtime-wired package seam
- Fixed on: 2026-02-26
- How fixed:
  - Added a dedicated auth package test seam export at `@jskit-ai/auth-provider-supabase-core/test-utils` and mapped it in package exports.
  - Repointed auth helper tests to import from the package seam instead of `../server/modules/auth/lib/*` app-local copies.
  - Added a guardrail test that fails if these auth tests reintroduce app-local auth-lib imports.
  - Code changes were applied in:
    - `/home/merc/Development/current/jskit-ai/packages/auth/auth-provider-supabase-core/package.json`
    - `/home/merc/Development/current/jskit-ai/packages/auth/auth-provider-supabase-core/src/test-utils.js`
    - `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/authRequestScopedSupabaseClient.test.js`
    - `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/oauthFlowsAndAuthMethods.test.js`
    - `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/authServiceHelpersBranches.test.js`
    - `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/authTestSeamContract.test.js`
- Validation:
  - `npm test -- tests/authTestSeamContract.test.js tests/authRequestScopedSupabaseClient.test.js tests/oauthFlowsAndAuthMethods.test.js tests/authServiceHelpersBranches.test.js tests/authService.test.js` (pass, 34 passed / 0 failed)
- Evidence:
  - /home/merc/Development/current/jskit-ai/packages/auth/auth-provider-supabase-core/package.json:12
  - /home/merc/Development/current/jskit-ai/packages/auth/auth-provider-supabase-core/src/test-utils.js:1
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/authRequestScopedSupabaseClient.test.js:8
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/oauthFlowsAndAuthMethods.test.js:5
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/authServiceHelpersBranches.test.js:22
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/authTestSeamContract.test.js:13
- Related:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/04-workspace-surface-policy-core.report.md [04-ISSUE-002]

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
