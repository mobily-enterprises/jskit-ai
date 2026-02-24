# @jskit-ai/knex-mysql-core

Shared MySQL + Knex runtime primitives for date normalization, duplicate-key detection, and retention helpers.

## Purpose

Centralize low-level MySQL/Knex utility helpers used by repositories and retention workers.

## Public API

- `@jskit-ai/knex-mysql-core/dateUtils`
  - `toIsoString`
  - `toMysqlDateTimeUtc`
- `@jskit-ai/knex-mysql-core/mysqlErrors`
  - `isMysqlDuplicateEntryError`
- `@jskit-ai/knex-mysql-core/retention`
  - `normalizeBatchSize`
  - `normalizeCutoffDateOrThrow`
  - `normalizeDeletedRowCount`
  - `deleteRowsOlderThan`

## Examples

```js
import { toMysqlDateTimeUtc } from "@jskit-ai/knex-mysql-core/dateUtils";
import { isMysqlDuplicateEntryError } from "@jskit-ai/knex-mysql-core/mysqlErrors";

const createdAt = toMysqlDateTimeUtc(new Date());

try {
  await db("users").insert({ email, created_at: createdAt });
} catch (error) {
  if (isMysqlDuplicateEntryError(error)) {
    // handle duplicate key
  }
}
```

## Non-goals

- Repository/domain business logic
- Framework transport concerns
- Non-MySQL SQL dialect abstractions
