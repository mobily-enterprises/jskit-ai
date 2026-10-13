# Data and resource operations

Provides reusable database, resource, CRUD, JSON API, upload, and transactional
payment or reward mechanics while leaving schemas and product workflows with
their owning package or application.

## Sources

- Main: `packages/database-runtime/src/server/databaseSetup.js`
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
