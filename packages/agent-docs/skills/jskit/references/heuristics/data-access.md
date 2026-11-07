<!-- Generated from `packages/agent-docs/heuristics/data-access.md`. -->

# Data access

Use when code reads or writes a database table: a repository, a batch, a lock,
a total or report, a transaction, a background job, or another feature's table.

Pick the layer ([Data access](../data-access.md)):

- One record, or one page of records: the owner's handle (`get`, `query`, `create`, `patch`, `delete`).
- Screens over HTTP: a CRUD contract on the same table resource.
- Many rows from one action: `createMany`, `patchMany`, `patchWhere`, `deleteMany`; never a loop of single writes.
- Two requests could change the same rows: `lockMany` inside `withTransaction`, rows in id order.
- Counts, sums, buckets: `aggregate`; newest per group: a window include; anything else: one `scopedQuery()` method under `// Knex: <kind> - <reason>`.
- Every workspace or user at once: a job with `systemScope`, looping over units, never rows.
- A table another feature owns: its service or owner API, never its table.
- Every path: a scope test and `expectFlatQueries`; a data test fails without `TEST_DB_NAME`.
