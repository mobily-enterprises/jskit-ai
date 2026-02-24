# @jskit-ai/knex-mysql-core

Shared MySQL + Knex utility primitives for date conversion, duplicate-entry detection, and retention delete helpers.

## What this package is for

Use this package in repository/data-access code when you need:

- strict date parsing and serialization
- MySQL duplicate-key detection that handles common error shapes
- reusable retention helpers for bounded deletion batches

## Key terms (plain language)

- `UTC`: timezone standard used to avoid local timezone drift.
- `duplicate entry`: MySQL unique-constraint conflict (error code `ER_DUP_ENTRY` / errno `1062`).
- `retention delete`: deleting old records in small batches.

## Exports

- `@jskit-ai/knex-mysql-core`
- `@jskit-ai/knex-mysql-core/dateUtils`
- `@jskit-ai/knex-mysql-core/mysqlErrors`
- `@jskit-ai/knex-mysql-core/retention`

## Function reference

### `dateUtils`

- `toIsoString(value)`
  - Converts valid date input to ISO UTC string.
  - Example: map DB `created_at` to API field `createdAt`.
- `toMysqlDateTimeUtc(value)`
  - Converts date to MySQL UTC datetime string `YYYY-MM-DD HH:mm:ss.SSS`.
  - Example: insert/update timestamp columns in consistent UTC format.

### `mysqlErrors`

- `isMysqlDuplicateEntryError(error)`
  - Returns `true` when `error.code === "ER_DUP_ENTRY"` or `errno === 1062`.
  - Example: convert DB unique violation to user-facing `409 Conflict`.

### `retention`

- `normalizeBatchSize(value, { fallback, max }?)`
  - validates positive integer batch size with max cap.
  - Example: CLI flag `--batchSize` sanitized to safe value.
- `normalizeCutoffDateOrThrow(value)`
  - validates cutoff date input.
  - Example: reject malformed retention cutoff date before query.
- `normalizeDeletedRowCount(value)`
  - coerces deletion result into non-negative number.
  - Example: normalize adapter-specific delete return values.
- `deleteRowsOlderThan({ client, tableName, dateColumn, cutoffDate, batchSize, applyFilters })`
  - selects bounded ID batch older than cutoff, optionally applies filters, deletes by IDs.
  - Example: delete only accepted/revoked/expired invites older than cutoff.

## Practical usage example

```js
import { toMysqlDateTimeUtc } from "@jskit-ai/knex-mysql-core/dateUtils";
import { isMysqlDuplicateEntryError } from "@jskit-ai/knex-mysql-core/mysqlErrors";
import { deleteRowsOlderThan } from "@jskit-ai/knex-mysql-core/retention";

try {
  await knex("workspace_memberships").insert({
    workspace_id: 10,
    user_id: 88,
    created_at: toMysqlDateTimeUtc(new Date())
  });
} catch (error) {
  if (isMysqlDuplicateEntryError(error)) {
    // convert to domain-level conflict response
  }
}

await deleteRowsOlderThan({
  client: knex,
  tableName: "workspace_invites",
  dateColumn: "updated_at",
  cutoffDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
  batchSize: 1000,
  applyFilters: (query) => query.whereIn("status", ["accepted", "revoked", "expired"])
});
```

## How `jskit-value-app` uses it and why

Real usage examples:

- date helpers in many repositories:
  - `apps/jskit-value-app/server/modules/chat/repositories/*.js`
  - `apps/jskit-value-app/server/modules/billing/repository.js`
  - `apps/jskit-value-app/server/modules/settings/repository.js`
- duplicate error checks:
  - `apps/jskit-value-app/server/modules/settings/service.js`
  - `apps/jskit-value-app/server/modules/chat/repositories/*.js`
- retention helpers:
  - chat repositories with `normalizeBatchSize` / `normalizeCutoffDateOrThrow`

Why:

- prevents repeated date/error/retention helper implementations in each repository
- keeps MySQL behavior consistent across domain modules

## Non-goals

- no domain-specific repository logic
- no transaction orchestration
- no SQL dialect abstraction beyond MySQL behavior
