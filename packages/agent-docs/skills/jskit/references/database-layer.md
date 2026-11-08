<!-- Generated from `packages/agent-docs/site/guide/app-setup/database-layer.md`. -->

# Database layer

JSKIT applications use Knex through one deliberately selected database driver.
Install either `@jskit-ai/database-runtime-mysql` or
`@jskit-ai/database-runtime-postgres`; do not install both unless the product
genuinely chooses a driver at runtime.

## Install the selected driver

For MySQL or MariaDB:

```bash
npm install @jskit-ai/database-runtime-mysql
```

For PostgreSQL:

```bash
npm install @jskit-ai/database-runtime-postgres
```

Each driver brings `@jskit-ai/database-runtime` and the appropriate Knex
driver through ordinary npm dependencies. There is no JSKIT install wizard.

## Connection environment

Keep credentials outside Git. Supply either `DATABASE_URL` or the individual
values:

```dotenv
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=exampleapp
DB_USER=exampleapp
DB_PASSWORD=secret
```

Use port `5432` for PostgreSQL. A single-driver app fixes its dialect in
`knexfile.js`, so it does not need `DB_CLIENT`. The running database provider
also derives its dialect from the installed driver and rejects a conflicting
`DB_CLIENT` value when one is supplied.

The application or hosting environment creates the database and provides its
credentials. JSKIT never guesses or commits them.

The running database provider registers a `database` health check that runs
`select 1` within two seconds. The foundations' `GET /api/health` answers `503`
while it fails; see [Health endpoint](/guide/app-setup/initial-scaffolding#health-endpoint).

## Migration configuration

Use the fixed-dialect pattern owned by the selected driver. The important
application file is small:

```js
import { createKnexMigrationConfigFromApp } from
  "@jskit-ai/database-runtime/server/knexMigrationConfig";

export default await createKnexMigrationConfigFromApp({ client: "mysql2", environment: process.env });
```

Use `client: "pg"` for PostgreSQL. The environment is always passed: JSKIT reads
the connection values from what the application gives it, never from
`process.env` on its own. The complete examples are in:

- `database/mysql-application`
- `database/postgres-application`

Each example is complete for its own engine. Copy files only from the selected
driver's pattern and never merge the two; for example, the CI workflow must
contain only that engine's database service.

The config discovers migrations directly from the current installed package
graph. Application migrations live in the app's `migrations/` directory;
package-owned migrations live in directories declared by the installed
package's `package.json#jskit.migrations.directories`.

There is no migration sync command and no copied migration projection. Knex
runs the authoritative files where their owners ship them.

## What runs migrations

The application owns normal npm scripts:

```json
{
  "scripts": {
    "db:migrate": "knex --knexfile ./knexfile.js migrate:latest",
    "db:migrate:rollback": "knex --knexfile ./knexfile.js migrate:rollback",
    "db:migrate:status": "knex --knexfile ./knexfile.js migrate:list"
  }
}
```

`npm run db:migrate` runs the Knex CLI. Knex loads `knexfile.js`, discovers the
application and installed-package migration directories, connects using the
environment, and applies pending migrations.

Deployment or a managed development environment may invoke this app-owned
script as a release step. JSKIT itself does not maintain a background migration
service.

## Authoring schema changes

Write a new immutable migration in the package that owns the schema. Never edit
an already-applied migration and never change a live database without recording
the equivalent source-controlled migration.

Package migrations are normal `.cjs` Knex migrations and are declared in that
package's metadata:

```json
{
  "jskit": {
    "migrations": {
      "directories": ["migrations"]
    }
  }
}
```

A `constraints/` subdirectory of a declared directory, such as
`migrations/constraints/`, holds the package's constraints migrations; it runs
later, as described below.

A package whose table migrations use another package's tables names that
package in `after`, and its migrations, and its constraints, then run after
that package's:

```json
{
  "jskit": {
    "migrations": {
      "directories": ["migrations"],
      "after": ["@jskit-ai/users-core"]
    }
  }
}
```

Each name in `after` must be another installed JSKIT package; a name that is
not installed, the package's own name, or packages that each name the other
stop discovery with an error. A named package without migrations orders
nothing.

Names must remain unique across the effective migration directories. Preserve
the basename when relocating a migration: Knex records that name in its ledger.
Do not rename it to force execution or edit an already-applied migration's body;
changed schema behavior requires a new migration.

### Directory order comes before filenames

`createKnexMigrationConfigFromApp()` sets `sortDirsSeparately: true` and runs
pending migrations in this order, using the default `migrationsDirectory`:

1. Discovered package migration directories, sorted by their absolute paths
   using `localeCompare`, except that a package's directories follow those of
   every package its `after` names, which follow theirs in turn, each in the
   order listed. Without `after` the path order is unchanged.
2. Application `migrations/`.
3. The `constraints/` subdirectory of each discovered package migration
   directory that has one, in the same order.
4. Application `migrations/constraints/`.

Knex sorts filenames within each directory, not across the whole graph; see
its [`sortDirsSeparately` option](https://knexjs.org/guide/migrations.html#migration-api).
Package discovery does not read tables or foreign keys; only `after` changes
the package order. A newer timestamp in an earlier package still runs before
every file in a later package.
Inspect the effective `knexfile.js` configuration if the app customizes it.

Every package table exists before the application's own migrations run, so a
root `migrations/` file can reference a package table directly, for example a
`books.user_id` foreign key to `users.id`. A package's table migrations must
never depend on an application table.

Keep table and column creation with the owning package. Put foreign keys
between two packages, and other constraints that need the complete schema, in a
constraints phase: the referencing package's own `constraints/` subdirectory
when it ships the key, or application `migrations/constraints/`. A package
constraints migration runs after the application's `migrations/`, so it can also
reference a table that may belong to the application, such as `users`; for
example, `@jskit-ai/assistant-runtime` adds its `users` and `workspaces` keys
from `migrations/constraints/`. Similarly, a `pet_notes.product_id` column can be
added by the pet-notes package, but its foreign key to the products package's
`products.id` belongs in a constraints phase. Do not rely on the
package-directory path order to make a cross-package reference work; when a
package's table migrations need another package's table, declare `after`.

Until `@jskit-ai/database-runtime` 0.1.252, root `migrations/` ran before the
package directories, so a fresh database failed on any application migration
that referenced a package table. Applied migrations stay in the Knex ledger;
only pending ones follow the new order. An application migration that still
creates a package-owned table belongs in that package.

The assistant-runtime, console-core and rewarded-core table migrations used to
add their keys to `users`, `workspaces` and later tables inline. A fresh MySQL
or MariaDB database failed when the parent table did not exist yet (errno 150),
and the assistant tables silently skipped their `workspaces` keys. They now add
them from `migrations/constraints/`. A database migrated earlier keeps the keys
it already has, and gains any that are missing.

`@jskit-ai/database-runtime/server/foreignKeyMigrations` serves constraints
migrations that must run on fresh and already-migrated databases alike.
`addMissingForeignKey(knex, key)` adds a single-column key only when no key
already links that column to the parent column. It fails, naming the table,
column and count, when rows have no parent, and it deletes nothing; repair
those rows and migrate again. `dropForeignKeyIfPresent(knex, key)` serves
`down()`.

Before adding the key, check that both tables and columns exist, the referenced
key is indexed appropriately, column types match (including integer signedness),
existing values have valid parents, and `ON DELETE SET NULL` uses a nullable
column. An incorrectly formed foreign key is not always an ordering failure.
Do not suppress the failure, skip a missing parent, or disable foreign-key
checks to make preparation appear successful.

### MySQL and MariaDB failures can leave partial schema

MySQL and MariaDB DDL can commit implicitly. If adding a column succeeds and a
later statement adding its foreign key fails, the column can remain even though
Knex has not recorded that migration as completed. A Knex transaction does not
make a multi-statement DDL migration atomic. See the
[MySQL implicit-commit rules](https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html)
and [MariaDB implicit-commit rules](https://mariadb.com/docs/server/reference/sql-statements/transactions/sql-statements-that-cause-an-implicit-commit).

Design new multi-step DDL migrations for their concrete partial states. Inspect
the column and foreign key independently; `hasColumn()` alone cannot prove the
constraint exists. Verify the definition of an existing object before skipping
its creation, complete only missing work, and fail clearly on incompatible
schema. Do not catch arbitrary SQL errors as success or mark incomplete work
as applied. Keep recovery local to the affected migration or an explicit repair;
do not add schema repair to request handlers or normal server startup.

For an existing failure, inspect the ledger and actual schema read-only first.
Preserve applied migration bodies and use a new corrective migration for
databases that already recorded them. If an earlier pending migration prevents
that correction from running, describe the required backed-up, explicit repair
before retrying; a later file alone cannot repair a blocked earlier step. Any
relocation must retain its basename and be checked against both fresh and
existing ledgers. Never drop valuable data or delete ledger entries to force
a replay.

## Seed data is not a migration

Migrations establish schema and invariant framework data. Product fixtures,
sample accounts, catalog content, and other environment-specific starting data
belong in an explicit, idempotent application seed operation that runs after
migrations. Do not hide product seeding in schema migrations.

Managed editors must be able to create one isolated database per development
session, apply the full migration graph, then invoke that explicit seed
operation. JSKIT supplies portable migration and seed seams; the editor owns
database allocation, credentials, lifetime, and environment injection.

## Resource services and custom operations

Conventional persisted resources use `defineTableResource()`,
`defineCrudContract()` and `defineCrudFeature()` so the framework owns
repeated table ownership, service, action, permission, JSON API, and route
mechanics. This does not make product CRUD behavior fixed.

- `decorateRepository` adds resource-specific queries, locks, or writes.
- `decorateService` overrides a standard method or adds domain methods such as
  `confirm`, `publish`, `cancel`, or `sendReminder`.
- `operationLifecycle` surrounds a standard operation with `before`, `execute`,
  `after`, and mutation-only `afterCommit` phases. Create, update, and delete
  phases before commit share one repository transaction, and `execute` receives
  `standard(nextInput)` for retaining the normal framework write.
- Named `actions` expose non-CRUD service methods through normal input,
  permission, event, and optional HTTP route contracts.

Repositories own database access. Services and lifecycle hooks orchestrate
repositories. External delivery belongs after commit; when it must be durable,
write an outbox record inside the transaction and deliver it separately.
A separate Feature is warranted when an operation belongs to another domain,
not merely because a useful resource has behavior beyond list and save. Write
it as a [typed feature](typed-features.md).

## Writes, versions, locks and deadlocks

Writes that skip their read-back (`returning`), optimistic locking
(`lockVersionField`), row locks and deadlock retries belong to the table
resource's handle: see [Data access](data-access.md), Layers 1
and 4 and [Transactions](data-access.md#transactions).

## Verification

- For every schema change, run the normal preparation entrypoint against a
  fresh disposable database on the selected engine with the complete package
  graph. An existing development database can hide ordering failures.
- In a separate disposable fixture at the previous schema and ledger, apply
  the upgrade and prove representative existing rows survive.
- For multi-step MySQL or MariaDB DDL, reproduce partial completion (for
  example, column present, foreign key absent, migration still pending), retry
  preparation, and verify the final column and constraint definitions.
- Run preparation again and `npm run db:migrate:status`; require no pending
  migrations. Prove invalid references are rejected and the declared delete
  behavior works. A stubbed Knex test or successful process exit is insufficient.
- Exercise a real transaction and one invalid-connection case.
- When a seed operation exists, run it twice and require the second run to be
  safe.
- Use the application's selected engine; exercise each supported engine when
  changing a shared pattern. Report unavailable database verification explicitly.

Do not add migration receipts, sync ledgers, generator provenance, or dialect
questionnaires. The installed graph, migration source, environment, and
database migration table are sufficient.

## Integration test databases

Disposable integration and migration tests use `TEST_DB_NAME`, never the
application's `DB_NAME`. A test run prepares that schema once and restores it
from a stored snapshot. `jskit test --databases` (the database patterns' `test`
script) does this with `@jskit-ai/database-runtime/server/testDatabases`, from
the application's `knexfile.js`:

- Each test file running at once gets a database of its own for as long as it
  runs, as both `DB_NAME` and `TEST_DB_NAME`: `TEST_DB_NAME` itself, then
  copies named `<TEST_DB_NAME>_1`, `_2`, ... up to the machine's test budget,
  as many as the database user may create. With no usable `TEST_DB_NAME`
  (unset, the connected database itself, or one the database user may not
  prepare), the files run one at a time on the connected database. A copy
  named like the application's database or `PROD_DB_NAME`, or a server that
  cannot be reached, fails the run instead.
- The snapshot holds the schema as the engine reports it and the rows the
  migrations wrote, including the migration ledger. On MySQL and MariaDB it is
  each table's `SHOW CREATE TABLE` and rows, in
  `node_modules/.cache/jskit-test-databases/`; on PostgreSQL it is the database
  `<TEST_DB_NAME>_snapshot`, which `CREATE DATABASE <name> TEMPLATE <snapshot>`
  copies while nothing is connected to it (the user needs `CREATEDB`), file by
  file (`STRATEGY FILE_COPY`) from PostgreSQL 15. Its key
  is a digest of the dialect, of the name and contents of every migration file
  that the application's `migrations/` and its installed packages supply, and
  of `package-lock.json`, since an upgraded package can change a helper its
  migrations import. MySQL test databases hold tables only: a schema with
  views, triggers, routines or events is refused.
- Each test file gets the environment `jskit test` was given, plus its
  database's connection (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`); the
  rest of the `.env` that `knexfile.js` loads is read for the databases only.
  The run's settings, connection password included, are in a file only the
  user can read; the runner's environment names only its directory.
- When that digest changes, the harness replays the migrations into the
  designated database once, outside the timed tests, and stores a new
  snapshot. Otherwise it restores the stored one.
- A schema the migrations alone do not build, such as migrations that start
  from a baseline schema file, or reference rows every test reads, comes from
  the application's own build: `knexfile.js` also exports
  `testDatabaseSchema = { files, build }`, and a browser `prepare` module passes
  the same `schema` to `prepareTestDatabases()`. `build(knex)` runs in the empty
  designated database instead of `knex.migrate.latest()` (the baseline, then
  `knex.migrate.latest()`), and `files` lists every file it reads, its own
  module included, relative to the application root: their contents join the
  digest, so changing one takes a new snapshot.
- A test that runs migrations up or down, or otherwise changes the tables,
  leaves its database dirty: its tables or migration ledger differ from the
  snapshot's. The harness restores the snapshot before another test file uses
  that database, instead of running `migrate.latest()` over the whole history.
- A browser run's seed is not part of the snapshot: it runs in each restored
  database, in one transaction ([Browser test preparation](#browser-test-preparation)).
- Only the fresh-schema check in [Verification](#verification) replays the
  whole history, as its own step.
- The harness reports each phase (digest, restore or rebuild, seed) with its
  duration, and those durations are read, so slow preparation is visible
  instead of hiding inside the next test that waits for it. A slow phase is
  fixed, never absorbed by a longer time limit.

Endpoints and batch operations get their own database tests at realistic row
counts that compare their query counts, counted with `countQueries()` from
`@jskit-ai/database-runtime/server/testDatabases`, or `countRuntimeQueries()`
for a route of the server the test boots; see the typed features guide's
[data access tests](data-access.md#tests).

## Browser test preparation

A browser run gives every Playwright worker its own server and its own copy of
`BROWSER_TEST_DB_NAME`. The database patterns' `example/tests/e2e/databases.js`
is the `prepare` module of `browserTestConfig({ prepare: "tests/e2e/databases.js" })`
from `@jskit-ai/jskit-catalog/browser-tests`: it calls `prepareTestDatabases()`
with `variable: "BROWSER_TEST_DB_NAME"`, the worker count and the app's fixture
seed, and returns each worker's `DB_NAME`. The worker's own process gets the
same environment as its server, so a test that opens the database itself (with
the app's `knexfile.js`) reaches that worker's copy. The copies (`<name>`, `<name>_1`,
...) are restored from the same stored snapshot as the Node test databases
([Integration test databases](#integration-test-databases)), then seeded in one
transaction each, so stale rows never survive a run and the migrations are
replayed only when one changes. It refuses the application's database,
`PROD_DB_NAME`, `TEST_DB_NAME` and their copies.

Give disposable integration and migration tests their own `TEST_DB_NAME`;
the two names, and their copies, must differ, and the application account
needs grants for each (a `<app>_%` grant covers the copies). Each preparation
reports how many databases it made, whether it replayed the migrations for a
new snapshot, and its restore and seed durations, so a cold rebuild is visible
to the caller.

Run related checks in one suite invocation and prepare only their required
fixtures. A local browser run serves the production build, never the
development launcher; fresh-schema migration proofs are separate. A managed
suite (`PLAYWRIGHT_BASE_URL`) uses the host's server URL and identity, as the
host serves it, starts no second server, and restores normal Preview after the
batch. Database isolation alone does not
disable email, payments or other external effects: configure those test controls
and verify the actual server identity before destructive requests.
