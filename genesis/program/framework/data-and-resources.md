# Data and resource operations

Provides reusable database, resource, CRUD, JSON API, upload, and transactional
payment or reward mechanics while leaving schemas and product workflows with
their owning package or application.

## Sources

- Main: `packages/database-runtime/src/server/databaseSetup.js`
- `packages/database-runtime/src/shared/repositoryOptions.js`
- `packages/crud-core/src/server/defineCrudJsonApiFeature.js`
- `packages/json-rest-api-core/src/server/jsonRestApiHost.js`
- `packages/uploads-runtime/src/server/providers/UploadsProvider.js`
- `packages/payments-core/src/server/service.js`
- `packages/rewarded-core/src/server/actions.js`

## Public contract

Consumers select a supported database driver, discover package-owned immutable
migrations, and use explicit repositories and transactions. Resource operations
provide validated read and mutation contracts, predictable missing-record and
failure behavior, and application-supplied authorization context. Upload,
payment, and reward facilities require application-owned configuration and
storage; selecting a package does not provision an external service.

A transaction the database aborts as a deadlock victim is rolled back in full
and runs again, up to three more times, when JSKIT opens it as the outermost
transaction. That covers `runInTransaction()`, `inTransaction()`, the seed
transaction, JSON REST repository `withTransaction()`, and CRUD writes that own
their transaction. A call joining an existing transaction fails at once and
leaves the retry to that transaction's owner. Retried callbacks must have no
external effects. Assistant conversation storage opts out because it never
replays a caller. `isDeadlockError()` and `retryDeadlocks()` give application
code the same behavior.
