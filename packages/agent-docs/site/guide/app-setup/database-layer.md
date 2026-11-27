# Database layer

JSKIT applications use Knex through one deliberately selected database driver.
Install either `@jskit-ai/database-runtime-mysql` or
`@jskit-ai/database-runtime-postgres`; do not install both unless the product
genuinely chooses a driver at runtime.

## Install the selected driver

For MySQL or MariaDB:

```bash
npm install @jskit-ai/database-runtime @jskit-ai/database-runtime-mysql
```

For PostgreSQL:

```bash
npm install @jskit-ai/database-runtime @jskit-ai/database-runtime-postgres
```

The application declares `@jskit-ai/database-runtime` itself: each driver takes
it as a peer, so the application holds its one copy, and brings its own Knex
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

A staging or production server's release, or a managed development
environment, may run this app-owned script as a release step. JSKIT itself does
not maintain a background migration service.

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
4. Application `migrations/constraints/`, when it exists.

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

### A new table takes the collation of the tables already there

MySQL and MariaDB create a table that names no character set or collation in
the database's default. A dump restored onto a server with another default
keeps each table's collation but takes the new database default, so a later
migration's new table no longer matches the tables it joins: comparing their
text fails with "Illegal mix of collations", and a foreign key between them is
refused (errno 150, "Foreign key constraint is incorrectly formed"). Up to
`@jskit-ai/jskit-catalog` 0.2.93, `auth_local_db_users_second_factors.cjs` failed
that way on such a database: it left an empty, unrecorded
`auth_local_second_factors` behind, and the migrations before it had recorded
their new tables in the new default, such as `auth_local_used_passes`.

Every JSKIT package migration that creates a table now creates it in the
collation of the existing tables, read from `information_schema`. Released
migrations stay as they are: each has a companion, the same name with
`-collation` before `.cjs`, which Knex sorts just before it (a `-` sorts before
`.`), so it runs first on every database that has not run it. The companion
calls `migrateInExistingCollation()` from
`@jskit-ai/database-runtime/server/tableCollationMigrations`, which runs the
released migration with each table it creates in the collation of the first
existing table of its list (the package's first table, then `users`, then
`auth_local_users`), and the released migration then finds its tables in place.
On PostgreSQL and SQLite, or before any of those tables exists, it does
nothing and the released migration runs as it did.

It also repairs what the database's default left, each only in the state it
measures, and changes nothing on a database whose tables are all in place, in
that collation, with their keys:

- an empty table of a migration Knex has not recorded, without the foreign key
  that migration creates with it, is what a refused key left: it is dropped
  and created again; with rows, the migration stops and changes nothing;
- a table of a recorded migration in another collation is converted when no
  stored character can be lost (its text is in the same character set, or one
  the target holds every character of, or it has no row), and otherwise the
  migration stops and changes nothing; it then gains a missing key, unless rows
  have no parent.

A new migration that creates a table calls `migrateInExistingCollation()` itself,
with its own file name and its table-creating `up`, so it needs no companion.
`tooling/jskit-catalog/test/tableCollationCompanions.test.js` fails for a table
migration that does neither, and names the released ones a companion cannot
serve: `payments_core_initial.cjs` and `connectors_core_initial.cjs` create
their tables without checking whether they exist, and `agent_initial.cjs` runs
on PostgreSQL only. Never change a database's default (`ALTER DATABASE`) to
make a migration pass: an application's own tables keep theirs.

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
  `standard(nextInput)` for retaining the normal framework write. A deadlock
  runs that transaction again, so `before`, `execute` and `after` can run twice
  and touch only the database; an outside effect (an email, an HTTP call) goes
  in `afterCommit`, which runs once after commit, or in an outbox row.
- Named `actions` expose non-CRUD service methods through normal input,
  permission, event, and optional HTTP route contracts.

The feature that owns a table reads and writes it through the handles its
`owns` entry gives its repository; services, hooks and other features call
that repository or the owner's API, never the table. External delivery belongs after commit; when it must be durable,
write an outbox record inside the transaction and deliver it separately.
A separate Feature is warranted when an operation belongs to another domain,
not merely because a useful resource has behavior beyond list and save. Write
it as a [typed feature](/guide/framework/typed-features).

## Writes, versions, locks and deadlocks

Writes that skip their read-back (`returning`), optimistic locking
(`lockVersionField`), row locks and deadlock retries belong to the table
resource's handle: see [Data access](/guide/framework/data-access), Layers 1
and 4 and [Transactions](/guide/framework/data-access#transactions).

## Verification

- For every schema change, run the normal preparation entrypoint against a
  fresh disposable database on the selected engine with the complete package
  graph. An existing development database can hide ordering failures.
- Run `jskit migration-history` as its own check, beside the test suite: test
  runs restore a snapshot and never replay the migrations, so it is what proves
  the whole history still builds, from empty, the schema the tests run on.
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
  runs, as both `DB_NAME` and `TEST_DB_NAME`, with the app's `DB_CLIENT`:
  `TEST_DB_NAME` itself, then copies named `<TEST_DB_NAME>_1`, `_2`, ... up to
  the machine's test budget, as many as the database user may create. So the
  user needs them all: on MySQL and MariaDB a grant on `TEST_DB_NAME` and on
  `` `<TEST_DB_NAME>\_%`.* `` (a grant reads an unescaped `_` as any
  character), on PostgreSQL `CREATEDB`. A run that gets fewer databases than
  the files its budget would run at once says so, and why, at its start and
  its end (`jskit test: test files run 1 at a time, not the 4 this machine's
  test budget allows: the database user may not create shop_test_1. ...`),
  and fails once its tests have run: a machine meant to run files in parallel
  never runs them one at a time unnoticed. With no usable `TEST_DB_NAME`
  (unset, the connected database itself, or one the database user may not
  prepare) the files run one at a time on the connected database, the same
  way. To run that way on purpose, set the budget to what the databases allow
  (`V64_TEST_CONCURRENCY=1`); a focused run of one file loses nothing and only
  says which database it used. A copy named like the application's database,
  `STAGING_DB_NAME` or `PRODUCTION_DB_NAME`, or a server that cannot be
  reached, fails the run instead. So does a run while `PROD_DB_NAME`, which
  those two replaced, is set.
  Every file starts from the snapshot, rows included: a copy an earlier file of
  the run used is restored before the next file takes it, so no file sees what
  another wrote. On MySQL and MariaDB the restore replaces only the tables that
  differ from the snapshot, found exactly: a table's definition and its
  `AUTO_INCREMENT` counter (`SHOW CREATE TABLE`, so a row written and deleted,
  or a write rolled back, counts), a trigger on it, a row in a table the
  snapshot holds empty, rows that are not the snapshot's, and tables missing or
  added. A file that wrote three tables costs three tables, not the whole
  schema. On PostgreSQL the copy is made again from the snapshot database,
  which costs less than finding the tables.
- When the run ends, whether its test files passed, failed or were stopped
  (Ctrl-C, `SIGTERM`), or its foreign key check failed before the first file,
  it drops the numbered copies it made and says so
  (`jskit test: dropped the run's 3 numbered test database(s).`); the next run
  makes them afresh from the snapshot. `TEST_DB_NAME` and the snapshot stay, so
  a later run in the same tree restores them instead of replaying the
  migrations. Only the copies the run made are dropped, and none a session is
  connected to, such as another run's: the run names each copy it kept and why.
- A run that never reached its end (killed with `SIGKILL`, stopped at a
  command's time limit, or on a machine that went down) leaves its copies. So
  every run, a browser run's `prepare` module included, starts by dropping the
  numbered copies of its database it will not make itself (`<name>_<count>` and
  up), none a session is connected to, and its summary says so
  (`dropped 1 numbered test database(s) earlier runs left (shop_test_7)`): a
  killed run's copies last until the next run starts, never longer. Only names
  JSKIT gives a copy count: `<name>_snapshot` and a project's own lettered
  copies stay. Two runs at once on one database name still are not supported.
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
- A test file that needs a scratch database beside its own copy, an empty one
  for tables the test creates or several at once, takes each from
  `createPackageTestKnex(t, { environment: process.env })` (from
  `@jskit-ai/resource-runtime/test`): with the run's `DB_CLIENT` in the file's
  environment, each call on MySQL or MariaDB claims one of the 26 lettered
  copies of the run's designated database, `<TEST_DB_NAME>_a` to `_z`,
  recreated empty and dropped after the test, and on PostgreSQL a schema of
  its own in the file's database
  ([data access tests](/guide/framework/data-access#tests)). A file is the
  unit that starts from the snapshot: tests that each need the snapshot's
  database afresh go in files of their own.
- A test that runs migrations up or down, or otherwise changes the tables,
  leaves its database dirty: its tables or migration ledger differ from the
  snapshot's. The harness restores the snapshot before another test file uses
  that database, instead of running `migrate.latest()` over the whole history.
- A browser run's seed is not part of the snapshot: it runs in each restored
  database, in one transaction ([Browser test preparation](#browser-test-preparation)).
- Only `jskit migration-history`, the full-history check in
  [Verification](#verification), replays the whole history, as its own step:
  the migrations, or the knexfile's `testDatabaseSchema` build, from empty
  into `TEST_DB_NAME`; a second pass that must find nothing left; then the
  tables, definitions and rows it built compared with the snapshot the tests
  run on, all but when each migration ran. It fails, naming what differs, when
  a migration builds something else on each replay (from the clock, a random
  value or what the server holds), and it leaves `TEST_DB_NAME` as the
  snapshot, so it needs no database a test run does not
  (`jskit migration-history: 42 migrations replayed from empty into shop_test
  in 3104ms, nothing left for a second pass, the same tables, definitions and
  rows as the test snapshot (37 tables)`).
- The harness reports each phase (digest, restore or rebuild, seed) with its
  duration, and those durations are read, so slow preparation is visible
  instead of hiding inside the next test that waits for it. A slow phase is
  fixed, never absorbed by a longer time limit.

Endpoints and batch operations get their own database tests at realistic row
counts that compare their query counts, counted with `countQueries()` from
`@jskit-ai/database-runtime/server/testDatabases`, or `countRuntimeQueries()`
for a route of the server the test boots; see the typed features guide's
[data access tests](/guide/framework/data-access#tests).

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
`STAGING_DB_NAME`, `PRODUCTION_DB_NAME`, `TEST_DB_NAME` and their copies.
When the run stops (Playwright's `SIGTERM`, Ctrl-C, or a start that failed), the
launcher stops its servers, whose sessions keep their copies, then drops the
numbered copies the `prepare` module made and says so
(`[browser-tests] dropped the run's 3 numbered test database(s).`), all within
the 10 s Playwright gives its webServer; `BROWSER_TEST_DB_NAME` and the snapshot
stay. `prepareTestDatabases()` itself drops the copies it made when it throws,
for a Node or a browser run alike.

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

A host's browser test target, such as a Vibe64 Outputs target with
``- Data: `test` ``, runs `jskit browser-test-server <host> <port> <workers>`:
`<workers>` servers of the app's own `browserTestConfig()` (1 to 64, else one),
worker *i* on `<port>`+*i*, on the production build, each with the database its
`prepare` module gives that worker (`BROWSER_TEST_DB_NAME` itself for the first
in the database patterns), its test-only `env` and `APP_ENV=test`, on the host's
address. The JSKIT Stack piece declares that target as `test-app`, so
`vibe64-helper playwright --target test-app npm-run test:e2e` runs the app's
suite against its own test database from the first commit, one Playwright worker
per server: the host lists them in `PLAYWRIGHT_WORKER_TARGETS`, and
`browserTestConfig()` gives each worker its own server and signed-in state and
refuses another worker count. The host names `<port>` in `PLAYWRIGHT_PORT`, so
each worker's process takes its own server's prepared environment, its
`DB_NAME` among them, as a local run's worker does
(`node_modules/.cache/jskit-browser-tests/workers-<port>.json`), however the
target's URL reaches that server; the suite runs in the app the target serves.
Without `PLAYWRIGHT_PORT` a worker opens no database. The target signs nothing
in; the host supplies each worker's login state through the target's Preview
identity, the same command as the normal target's.

A process a test run gave its databases opens no other: in a `jskit test
--databases` file (its copy, and the lettered copies its package data tests
claim) and in a browser run's Playwright worker (its own server's), the app's
knexfile settings (`createKnexMigrationConfig()`) and its runtime's database
refuse any other name before connecting, naming `DB_NAME` or `DATABASE_URL`
and the fix, so a test never reaches a development or production database
whatever its environment holds. The processes such a process starts inherit
the rule (`JSKIT_TEST_DATABASE_GUARD`).
