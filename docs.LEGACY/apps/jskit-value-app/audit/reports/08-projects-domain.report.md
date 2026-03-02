## Broken things

### [08-ISSUE-001] Projects actions trust caller-supplied workspace/user over execution context
- Status: OPEN
- Severity: P0
- Confidence: high
- Contract area: tenancy
- First seen: 2026-02-26
- Last seen: 2026-02-26
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/projects.contributor.js:44
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/projects.contributor.js:49
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/projects.contributor.js:334
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/buildExecutionContext.js:78
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/projects/service.js:125
- Why this is broken:
  - `resolveWorkspace`/`resolveUser` prioritize `input.workspace` and `input.user` ahead of authenticated execution context. Runtime validation confirmed a `projects.list` action call accepted injected `input.workspace.id=999` and executed against that workspace instead of `context.workspace.id=11`. This breaks tenant and principal integrity for `assistant_tool`/`internal` channels.
- Suggested fix:
  - Make contributor identity/workspace resolution context-authoritative (`request/context` first) and ignore caller-supplied `input.workspace`/`input.user` for `api` and `assistant_tool` channels. If internal impersonation is required, gate it behind explicit internal-only actions/flags.
- Suggested tests:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/projectsActionContributor.test.js
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/actionRegistry.test.js
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/assistantToolContextIntegrity.test.js
- Related:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/06-action-runtime-composition.report.md [06-ISSUE-001]

### [08-ISSUE-002] Projects assistant-tool schemas drift from the projects service contract
- Status: OPEN
- Severity: P1
- Confidence: high
- Contract area: action-runtime
- First seen: 2026-02-26
- Last seen: 2026-02-26
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/projects.contributor.js:155
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/projects.contributor.js:186
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/projects.contributor.js:217
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/projects/service.js:127
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/projects/service.js:166
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/projects/service.js:191
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/projects/schema.js:65
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/projects/schema.js:80
- Why this is broken:
  - Assistant-tool schema allows `pageSize` up to `200`, but service behavior hard-clamps to `100`. Assistant-tool create/update schemas expose `description` while service/API contracts use `owner` and `notes`. Runtime validation showed `{ description: "..." }` is ignored and persisted as empty `owner`/`notes`, and `pageSize: 200` is silently reduced to `100`.
- Suggested fix:
  - Align assistant-tool input schemas with canonical projects API/service contracts: replace `description` with `owner`/`notes`, and set list `pageSize` max to `100` (or change service/api max in one canonical place if `200` is desired).
- Suggested tests:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/projectsActionContributor.test.js
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/actionRegistry.test.js
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/client/api.vitest.js
- Related:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/09-deg2rad-history-domain.report.md [09-ISSUE-001]

### [08-ISSUE-003] Projects detail/edit view route parsing can throw on malformed encoded IDs
- Status: OPEN
- Severity: P2
- Confidence: high
- Contract area: security
- First seen: 2026-02-26
- Last seen: 2026-02-26
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/projects/useProjectsView.js:17
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/projects/useProjectsEdit.js:18
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/authPermissions.test.js:206
- Why this is broken:
  - Both view hooks call `decodeURIComponent` on the captured project path segment without guarding decode failures. Malformed encoded segments (for example `%E0%A4%A`) throw `URIError` and can crash the view state path before API-level validation is reached.
- Suggested fix:
  - Wrap route-segment decode in a safe parser (`try/catch` with empty-string fallback), or source route params from router APIs that provide already-sanitized values.
- Suggested tests:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/views/projectsView.vitest.js
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/views/projectsEditView.vitest.js

### [08-ISSUE-004] Projects mutating actions publish realtime events without enforcing correlation headers
- Status: OPEN
- Severity: P2
- Confidence: high
- Contract area: realtime
- First seen: 2026-02-26
- Last seen: 2026-02-26
- Evidence:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/flows/01.endpoint-a-to-z.md:212
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/projects.contributor.js:100
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/projects.contributor.js:388
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/projects.contributor.js:499
- Why this is broken:
  - Flow docs define a correlation guardrail requiring `x-command-id` and `x-client-id` on event-producing writes, but projects create/update always publish even when both values are missing. Runtime validation produced a published event with `commandId: null` and `sourceClientId: null`.
- Suggested fix:
  - Enforce correlation metadata for mutating projects actions (reject missing IDs or generate/propagate required IDs before publish) and keep action/docs behavior consistent across `api`, `assistant_tool`, and `internal`.
- Suggested tests:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/projectsActionContributor.test.js
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests/client/api.vitest.js
- Related:
  - /home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/09-deg2rad-history-domain.report.md [09-ISSUE-002]

## Fixed things

## Won't fix things
