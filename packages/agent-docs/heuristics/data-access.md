# Data access

Use when code reads or writes a database table: a repository, a batch, a lock,
a total or report, a transaction, a background job, or another feature's table.

Pick the layer ([Data access](../site/guide/framework/data-access.md)):

- One record, or one page of records: the owner's handle (`get`, `query`, `create`, `patch`, `delete`).
- Screens over HTTP: a CRUD contract on the same table resource.
- Many rows from one action: `createMany`, `patchMany`, `patchWhere`, `deleteWhere`; never a loop of single writes.
- Two requests could change the same rows: `lockMany` inside `withTransaction`, rows in id order.
- A change only while a row still holds a value (open to booked, once): `patch` with `onlyIf`, or `patchWhere` with that value in its filters on the row's own columns (both check it on the locked row, so of two concurrent writers one wins); a filter on a related table is no guard on MySQL and MariaDB, so lock the related rows first (`lockMany`), or use `claim`.
- Counts, sums, buckets: `aggregate`; newest per group: a window include; anything else: one `scopedQuery()` method under `// Knex: <kind> - <reason>`.
- Every workspace or user at once: a job with `systemScope`, finding its units with an `aggregate` grouped by the ownership field and looping over them, never rows.
- A table another feature owns: its service or owner API, never its table. A report that joins it joins the `{ query, column }` its owner API answers from `scopedQuery({ alias })`, as a subquery: one statement, both scopes kept.
- Every path: a scope test and `expectFlatQueries`; a data test fails without `TEST_DB_NAME`.
