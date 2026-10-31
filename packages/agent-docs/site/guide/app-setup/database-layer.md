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

## Migration configuration

Use the fixed-dialect pattern owned by the selected driver. The important
application file is small:

```js
import { createKnexMigrationConfigFromApp } from
  "@jskit-ai/database-runtime/server/knexMigrationConfig";

export default await createKnexMigrationConfigFromApp({ client: "mysql2" });
```

Use `client: "pg"` for PostgreSQL. The complete examples are in:

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

Names must remain unique across the effective migration directories. Preserve
the basename when relocating a migration: Knex records that name in its ledger.
Do not rename it to force execution or edit an already-applied migration's body;
changed schema behavior requires a new migration.

### Directory order comes before filenames

`createKnexMigrationConfigFromApp()` sets `sortDirsSeparately: true` and runs
pending migrations in this order, using the default `migrationsDirectory`:

1. Discovered package migration directories, sorted by their absolute paths
   using `localeCompare`.
2. Application `migrations/`.
3. Application `migrations/constraints/`.

Knex sorts filenames within each directory, not across the whole graph; see
its [`sortDirsSeparately` option](https://knexjs.org/guide/migrations.html#migration-api).
Package discovery does not topologically order tables or foreign keys. A newer
timestamp in an earlier package still runs before every file in a later package.
Inspect the effective `knexfile.js` configuration if the app customizes it.

Every package table exists before the application's own migrations run, so a
root `migrations/` file can reference a package table directly, for example a
`books.user_id` foreign key to `users.id`. A package migration must never depend
on an application table.

Keep table and column creation with the owning package. Put foreign keys
between two packages, and other constraints that need the complete schema, in
application `migrations/constraints/`. For example, a `pet_notes.product_id`
column can be added by the pet-notes package, but its foreign key to the
products package's `products.id` belongs in the final constraints phase. Do not
rely on today's package-directory order to make a cross-package reference work.

Until `@jskit-ai/database-runtime` 0.1.252, root `migrations/` ran before the
package directories, so a fresh database failed on any application migration
that referenced a package table. Applied migrations stay in the Knex ledger;
only pending ones follow the new order. An application migration that still
creates a package-owned table belongs in that package.

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

Conventional persisted resources use `defineCrudResource()` and
`defineCrudJsonApiFeature()` so the framework owns repeated repository,
service, action, permission, JSON API, and route mechanics. This does not make
product CRUD behavior fixed.

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
not merely because a useful resource has behavior beyond list and save.

## Deadlock retries

When the database aborts a transaction as a deadlock victim (MySQL and MariaDB
`ER_LOCK_DEADLOCK`, errno 1213; PostgreSQL `40P01`), it rolls the whole
transaction back, so JSKIT runs the whole transaction callback again, up to
three more times with a short random pause. The person sees one successful
request instead of a 500. This applies to `runInTransaction()` and
`createWithTransaction()` from `@jskit-ai/database-runtime/shared`, to
`transactionManager.inTransaction()`, to the seed transaction, to every JSON
REST repository's `withTransaction()` (CRUD, users and workspaces), and to a
CRUD `createDocument`, `patchDocumentById` or `deleteDocumentById` given no
`trx`, which owns its own transaction. A lock wait timeout (errno 1205) is not
retried.

Only the outermost transaction retries. A call given an existing `trx`, or a
`runInTransaction()` on a transaction, which opens a savepoint, fails at once
and leaves the retry to the transaction that owns it.

A retried callback must be safe to run again: keep HTTP calls, email, file
uploads and other external effects out of it, before or after the transaction
or in an outbox, as above. CRUD lifecycle `before`, `execute` and `after`
phases are inside the transaction; `afterCommit` is not. A transaction whose
callback cannot be repeated passes `{ retries: 0 }`:
`runInTransaction(knex, work, { retries: 0 })`.

Application code that opens transactions directly uses the same behavior through
`runInTransaction(knex, work)` instead of `knex.transaction(work)`, or wraps any
other transaction opener in `retryDeadlocks(() => open(work))`. `isDeadlockError(error)`
follows `error.cause` and is false for an error that reports
`transactionOutcome: "committed"`, because that transaction must not run again.

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

## Browser test preparation

Keep the test schema and migration history between routine browser runs. The
MySQL application pattern includes `example/tests/browser/database.js`: it
validates the exact `BROWSER_TEST_DB_NAME`, applies pending migrations, clears test rows,
and runs one explicit fixture seed. Restore migration-owned baseline rows in
that seed. Prove repeat preparation, stale-data removal, pending migrations, and
isolation from the normal database before adopting the launcher. Give disposable
integration and migration tests their own `TEST_DB_NAME`; require the two names
to differ and provision exact grants for each. Run disposable cleanup between
two browser preparations in the regression test to prove it cannot erase the
reusable schema. Startup reports applied migration counts and phase durations
so a cold rebuild is visible to the caller.

Run related checks in one suite invocation and prepare only their required
fixtures. The application foundations use the development launcher for ordinary
browser checks; fresh-schema migration proofs and production builds are separate.
A managed suite uses the host's server URL and identity, starts no second server,
and restores normal Preview after the batch. Database isolation alone does not
disable email, payments or other external effects: configure those test controls
and verify the actual server identity before destructive requests.
