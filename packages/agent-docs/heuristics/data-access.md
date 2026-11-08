# Data access

Use when code reads or writes a database table: a repository, a batch, a lock,
a total or report, a transaction, a background job, or another feature's table.

Pick the layer ([Data access](../site/guide/framework/data-access.md)):

- One record, or one page of records: the owner's handle (`get`, `query`, `create`, `patch`, `delete`).
- Screens over HTTP: a CRUD contract on the same table resource.
- Many rows from one action: `createMany`, `patchMany`, `patchWhere`, `deleteWhere`; never a loop of single writes.
- Two requests could change the same rows: `lockMany` inside `withTransaction`, rows in id order.
- A method wraps its own table's write in `withTransaction`: that write gets `{ ...options, ...txOptions }`. `txOptions` alone is only the context and transaction, so the caller's `returning`, `missing` or `format` never reaches it.
- A change only while a row still holds a value (open to booked, once): `patch` with `onlyIf`, or `patchWhere` with that value in its filters (a compare-and-set on every database, so of two concurrent writers one wins); a filter on a related table is refused on MySQL and MariaDB (`selection_cross_table`), so filter on the row's own columns, after locking the related rows with `lockMany`, or use `claim`.
- Counts, sums, buckets: `aggregate`; newest per group: a window include; anything else: one `scopedQuery()` method under `// Knex: <kind> - <reason>`.
- Every workspace or user at once: a job with `systemScope`, finding its units with an `aggregate` grouped by the ownership field and looping over them, never rows.
- A table another feature owns: its service or owner API, never its table. A report that joins it joins the `{ query, column }` its owner API answers from `scopedQuery({ alias })`, as a subquery: one statement, both scopes kept.
- Every path: a scope test and `expectFlatQueries`; a data test fails without `TEST_DB_NAME`.
