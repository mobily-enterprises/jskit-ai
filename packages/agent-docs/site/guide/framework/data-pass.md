---
title: Data pass
description: The owner layer, query counters, constraint tests, migration mechanics and PostgreSQL and MySQL differences a data pass uses in a JSKIT app.
---

# Data pass

A data pass makes an app's data hold up at real sizes. Genesis's data pass
skill (`genesis-data-pass`) holds the method: map the data, measure each path
at a few rows and at a realistic size, then make counts follow the rows read,
narrow reads in the query, enforce and try every constraint, migrate safely,
index the real filters, and leave tests at realistic sizes. This page says
which JSKIT pieces each step uses. The rules themselves are in
[Data access](/guide/framework/data-access) and the [sanity checks](/guide/framework/sanity-checks);
read the sections each step names.

## Map the data

- Each table has one owner: the feature whose table resource (`own()`)
  declares it ([The resource is the only door](/guide/framework/data-access#the-resource-is-the-only-door)).
  Other features read it through that owner
  ([Tables you don't own](/guide/framework/data-access#tables-you-don-t-own)).
  `expectEveryTableOwned()` fails on a table nobody owns.
- A table's constraints and indexes are in the migrations of the package that
  owns it, and the foreign keys between packages in a `constraints/`
  subdirectory ([Directory order comes before filenames](/guide/app-setup/database-layer#directory-order-comes-before-filenames)).
- The paths to measure are the CRUD lists and records, the feature's actions
  and services, the [many-row writes](/guide/framework/data-access#layer-3-many-rows-at-once),
  the [reports](/guide/framework/data-access#layer-5-reports-the-resource-cannot-express)
  and the [background work](/guide/framework/data-access#background-work).

## Measure

Count each path's statements on `TEST_DB_NAME`, never `DB_NAME`, with
`expectFlatQueries()` from `@jskit-ai/resource-runtime/test`, or
`countQueries(knex, work)` from
`@jskit-ai/database-runtime/server/testDatabases` when you want the counts and
statements themselves ([Tests](/guide/framework/data-access#tests),
[Query counts and batches](/guide/framework/sanity-checks#query-counts-and-batches)).
Record each count at a few rows and at the realistic size before changing
anything; the report compares them.

## Fix the paths

- **Counts follow the rows read.** A handle's `get()` or `query()`, or a
  service call, inside a loop becomes one id-list read through `queryAll()` or
  `include`, grouped with `Map.groupBy()`
  ([Reads shaped for the screen](/guide/framework/data-access#reads-shaped-for-the-screen)).
  A write that does not use its result passes `returning: "id"` or `"none"`; a
  batch uses `createMany()` and `patchMany()`.
- **The query narrows.** Filters, sorts, limits, existence checks and counts go
  in the read: the searchSchema's filters, `q` for typed text, `take: 1` for
  one row, `aggregate()` for a count
  ([Narrow in the query](/guide/framework/data-access#narrow-in-the-query)).
  The lint rules `jskit/narrow-in-query` and `jskit/search-on-server`, and
  `jskit check`'s `data/search-q`, report what they can see.
- A fix that needs an API the owner does not have is asked of that owner, or
  of JSKIT for its packages, never written around it
  ([Exceptions](/guide/framework/data-access#exceptions)).

## Constraints

- Required fields, enumerations and ranges are in the resource's schema, and
  required, unique and foreign keys in the table's migration. A rule the
  schema cannot express, such as a uniqueness within an owner or a check that
  reads another row, belongs to the owner's service, inside its
  [transaction](/guide/framework/data-access#transactions).
- Try each one: a server test sends one value that breaks it and asserts the
  refusal's status and code, and that the message tells the person what to do
  ([Every refusal explained](/guide/framework/quality-pass#every-refusal-explained)).
  A unique or foreign key the database enforces needs that test too, so its
  error reaches the person as a sentence, not a 500.
- `addMissingForeignKey(knex, key)` from
  `@jskit-ai/database-runtime/server/foreignKeyMigrations` adds a key on fresh
  and already-migrated databases alike; it fails, naming the rows with no
  parent, and deletes nothing. Before adding any constraint, count the rows
  that break it; ask the person what they should say rather than rewrite them.

## Migrations

- Each change is a new `.cjs` Knex migration in the package that owns the
  table; one that has run anywhere is never edited
  ([Authoring schema changes](/guide/app-setup/database-layer#authoring-schema-changes),
  [Migration ownership](/guide/framework/crud-operations#migration-ownership)).
- Backfill large tables in bounded chunks with the many-row writes, from a job
  or a script, not inside one migration statement that holds a lock for its
  whole run. Seed data is not a migration
  ([Seed data is not a migration](/guide/app-setup/database-layer#seed-data-is-not-a-migration)).
- Prove a migration on the selected engine as the database layer's
  [Verification](/guide/app-setup/database-layer#verification) describes: fresh
  preparation, an upgrade that keeps rows, and a second preparation with
  nothing pending. Changing a migration or seed source changes the test
  databases' snapshot digest, so the next test run rebuilds them
  ([Integration test databases](/guide/app-setup/database-layer#integration-test-databases)).

## Indexes

- Take the filters, sorts and joins from the statements `countQueries()`
  captured, and give each an index in a new migration, its columns in the order
  the query uses them; the owner columns of a scoped table usually come first.
- A filter on another table's field needs that field declared `indexed: true`
  on its own table resource, with a database index on its column; `own()`
  refuses it at startup otherwise ([Layer 1: the table resource](/guide/framework/data-access#layer-1-the-table-resource)).
- `lockWhere` needs an index that starts with the ownership columns, and with
  `sort` or `limit` one that reads rows in the lock's order; without it the
  lock refuses and names the index ([Layer 4: locks](/guide/framework/data-access#layer-4-locks)).
- Read the plan on the test database at the realistic size (below, per engine)
  and see each index used.

## Tests at realistic sizes

- Each list, batch and write path keeps a one-line `expectFlatQueries()` test
  whose `seed` builds the realistic size; each scoped path keeps an
  `expectScoped()` test proving another owner's rows stay unseen and unchanged
  ([Tests](/guide/framework/data-access#tests)).
- A capped read keeps a test that seeds past its cap and finds the row it
  needs.
- Run `npm run lint`, `npx jskit check` and `npm run verify`.

## PostgreSQL

- `CREATE INDEX CONCURRENTLY` builds an index without blocking writes, but
  cannot run in a transaction: give that migration `exports.config = {
  transaction: false }` and nothing else, and use `DROP INDEX CONCURRENTLY` in
  its `down()`. A failed concurrent build leaves an invalid index behind; drop
  it before retrying.
- On a large table, add a foreign key or check `NOT VALID`, which takes only a
  brief lock and enforces it for new rows, then `VALIDATE CONSTRAINT` in a
  later migration, which reads the old rows without blocking writes.
- Adding a column with a constant default is instant; changing a column's type
  rewrites the table and locks it for the whole rewrite.
- PostgreSQL does not index a foreign key's column for you: index it when the
  app filters or joins by it, or deletes parent rows.
- A partial index (`WHERE archived_at IS NULL`) serves a filter the app always
  applies, at a fraction of the size.
- Read plans with `EXPLAIN (ANALYZE, BUFFERS)`, after `ANALYZE` on freshly
  seeded tables, so the planner sees the realistic size.
- Counts and sums come back as strings; compare them with `Number()` in tests.

## MySQL

- DDL commits as it goes, so a migration with several schema statements can
  stop half-applied: one schema change per migration, written for its partial
  states ([MySQL and MariaDB failures can leave partial schema](/guide/app-setup/database-layer#mysql-and-mariadb-failures-can-leave-partial-schema)).
- Ask for an online change explicitly, `ALGORITHM=INPLACE, LOCK=NONE` (or
  `ALGORITHM=INSTANT` to add a column), so a change that would lock the table
  fails instead of locking it.
- InnoDB indexes each foreign key's column itself; an index whose leading
  columns match makes it a duplicate.
- MySQL has no partial indexes; an index on the filtered column plus the owner
  columns serves the same filter.
- With the `utf8mb4_0900_ai_ci` collation a unique key ignores case and accents
  (`Soup` and `soup` collide); try a value that differs only in case when such a
  key is a constraint.
- Read plans with `EXPLAIN ANALYZE` (MySQL 8.0.18 and later; `EXPLAIN` on
  MariaDB).
- `information_schema` reads are slow and lock metadata: keep them in
  migrations and checks, never on a request path.
