# @jskit-ai/security-audit-core

Security audit event service with normalization, metadata sanitization, and safe-write mode.

## What this package is for

Use this package to record security-sensitive actions in a consistent way, such as:

- sign-in success/failure
- permission-denied operations
- role or membership changes
- invite acceptance/revocation actions

The service normalizes input fields and sanitizes metadata before writing to storage.

## Key terms (plain language)

- `audit event`: a structured record of an important security action.
- `metadata`: extra context fields attached to an event (IP, payload bits, etc.).
- `redaction`: replacing sensitive values (passwords/tokens) with a safe placeholder.

## Exports

- `@jskit-ai/security-audit-core`
- `@jskit-ai/security-audit-core/service`

Public runtime API:

- `createService({ auditEventsRepository, observabilityService })`

`__testables` is for tests.

## Function reference

### `createService({ auditEventsRepository, observabilityService })`

Creates the audit service.

Required dependency:

- `auditEventsRepository.insert(event)`

Optional dependency:

- `observabilityService.recordSecurityAuditEvent({ action, outcome, surface })`

Returns methods:

- `record(event)`
  - Normalizes/sanitizes event fields.
  - Requires a non-empty `action`.
  - Persists via repository and emits audit metric when available.
  - Real-life example: record a failed admin access attempt with `outcome: "failure"` and sanitized metadata.

- `recordSafe(event, logger)`
  - Same behavior as `record`, but never throws to caller.
  - On failure it logs a warning with normalized error info and returns `null`.
  - Real-life example: in non-critical middleware, log audit failures but continue serving user request.

## Practical usage example

```js
import { createService as createAuditService } from "@jskit-ai/security-audit-core";

const auditService = createAuditService({
  auditEventsRepository,
  observabilityService
});

await auditService.record({
  action: "workspace.member.role_updated",
  outcome: "success",
  actorUserId: 12,
  targetUserId: 31,
  workspaceId: 9,
  surface: "admin",
  requestId: "req_abc123",
  method: "PATCH",
  path: "/api/admin/workspace/members/31",
  metadata: { changedRole: "editor" }
});
```

## How `jskit-value-app` uses it and why

Real usage:

- `apps/jskit-value-app/server/runtime/services.js`
- `apps/jskit-value-app/tests/securityAuditService.test.js`

Why:

- all modules record audit events through one shared normalizer/sanitizer
- sensitive keys in metadata are redacted consistently
- observability metrics for audit writes stay uniform

## Non-goals

- no database-specific logic (repository handles persistence)
- no policy decision making (only recording outcomes)
- no HTTP transport concerns
