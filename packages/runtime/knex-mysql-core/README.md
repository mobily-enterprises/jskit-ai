# @jskit-ai/knex-mysql-core

Shared MySQL + Knex runtime primitives for date normalization, duplicate-key detection, and retention helpers.

## Scope

- `toIsoString`
- `toMysqlDateTimeUtc`
- `isMysqlDuplicateEntryError`
- `normalizeBatchSize`
- `normalizeCutoffDateOrThrow`
- `normalizeDeletedRowCount`
- `deleteRowsOlderThan`

## Non-goals

- Repository/domain business logic
- Framework transport concerns
- Non-MySQL SQL dialect abstractions
