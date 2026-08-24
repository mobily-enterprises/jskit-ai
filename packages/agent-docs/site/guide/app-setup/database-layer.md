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

Names must remain unique across the effective migration directories. Keep
constraints in a later migration when ordering matters.

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
  permission, audit, event, and optional HTTP route contracts.

Repositories own database access. Services and lifecycle hooks orchestrate
repositories. External delivery belongs after commit; when it must be durable,
write an outbox record inside the transaction and deliver it separately.
A separate Feature is warranted when an operation belongs to another domain,
not merely because a useful resource has behavior beyond list and save.

## Verification

- Rebuild a disposable database from the complete migration graph.
- Run `npm run db:migrate:status` after migration.
- Exercise a real transaction and one invalid-connection case.
- When a seed operation exists, run it twice and require the second run to be
  safe.
- Test MySQL and PostgreSQL patterns independently.

Do not add migration receipts, sync ledgers, generator provenance, or dialect
questionnaires. The installed graph, migration source, environment, and
database migration table are sufficient.
