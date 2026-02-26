## Broken things

### [ISSUE-001] Unmapped auth-provider client errors are returned verbatim to API callers
- Severity: P2
- Confidence: high
- Contract area: security
- First seen: 2026-02-26
- Last seen: 2026-02-26
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/auth/lib/authErrorMappers.js:90
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/auth/lib/authErrorMappers.js:97
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/auth/lib/accountFlows.js:181
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/auth/lib/oauthFlows.js:187
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/RAILS.md:93
- Why this is broken:
  - `mapAuthError` forwards provider-supplied 4xx messages directly (`new AppError(status, message)`) when no explicit mapping matches. Multiple auth/session flows route provider errors through this mapper, so internal/provider messages can leak to API consumers, violating the project error-handling rail.
- Suggested fix:
  - Replace fallback message pass-through with a strict allowlist of safe user-facing messages and default to a generic error string for unmapped provider responses.
- Suggested tests:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/authService.test.js
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/authServiceHelpersBranches.test.js
- Related:
  - None.

### [ISSUE-002] Auth helper tests target app-local auth copies instead of the runtime-wired package seam
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
- Related:
  - None.

## Fixed things

## Won't fix things
