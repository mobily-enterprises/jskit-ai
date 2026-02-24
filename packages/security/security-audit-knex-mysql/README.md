# @jskit-ai/security-audit-knex-mysql

Knex/MySQL repository for persisting and retaining security audit events.

## What this package is for

Use this package when you need database persistence for the audit service in `@jskit-ai/security-audit-core`.

It provides a repository factory with methods to:

- insert audit events
- delete old events in batches for retention
- run work inside transactions

## Key terms (plain language)

- `repository`: a data-access object that reads/writes DB rows.
- `transaction`: a DB unit of work where related writes either all succeed or all fail.

## Exports

- `@jskit-ai/security-audit-knex-mysql`
- `@jskit-ai/security-audit-knex-mysql/repositories/auditEvents`

Public runtime API:

- `createRepository(dbClient)`

`__testables` is for tests.

## Function reference

### `createRepository(dbClient)`

Creates and returns an audit-events repository.

- `dbClient` must be a Knex-like callable client.

Returned methods:

- `insert(event, options?)`
  - Writes a row to `security_audit_events`, then returns mapped API shape.
  - Metadata is JSON-stringified safely.
  - Real-life example: write login-failure audit entry with request info.

- `deleteOlderThan(cutoffDate, batchSize?, options?)`
  - Deletes rows older than `cutoffDate` in bounded batches.
  - Real-life example: nightly retention sweep removes audit rows older than 365 days.

- `transaction(callback)`
  - Runs callback in DB transaction when supported.
  - Real-life example: write audit row in same transaction as another security-sensitive mutation.

## Practical usage example

```js
import { createRepository as createAuditEventsRepository } from
  "@jskit-ai/security-audit-knex-mysql/repositories/auditEvents";

const auditEventsRepository = createAuditEventsRepository(knex);

await auditEventsRepository.insert({
  action: "console.invite.revoked",
  outcome: "success",
  actorUserId: 10,
  targetUserId: 15,
  metadata: { inviteId: 77 }
});
```

## How `jskit-value-app` uses it and why

Real usage:

- `apps/jskit-value-app/server/runtime/repositories.js`

Why:

- app services can depend on a stable audit repository interface
- retention workers can call the same repository for old-row cleanup
- MySQL date/JSON mapping stays centralized in one place

## Non-goals

- no audit event validation policy (handled by service layer)
- no route/controller logic
- no DB migration management
