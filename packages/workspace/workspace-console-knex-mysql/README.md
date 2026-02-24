# @jskit-ai/workspace-console-knex-mysql

Knex/MySQL repositories for console memberships, invites, root identity, settings, and error logs.

## What this package is for

Use this package as the persistence layer for console/admin features:

- who is a console member and which role they have
- console invite lifecycle
- singleton root identity assignment
- singleton console settings row
- browser/server error log ingestion and querying
- retention deletions for console error and invite artifact tables

## Key terms (plain language)

- `singleton row`: exactly one row for global state (for example console settings id `1`).
- `artifact retention`: deleting old processed records (accepted/revoked/expired invites, old error logs).

## Exports

Package-level aliases:

- `createConsoleMembershipsRepository`
- `createConsoleInvitesRepository`
- `createConsoleRootRepository`
- `createConsoleSettingsRepository`
- `createConsoleErrorLogsRepository`

Direct repository subpaths:

- `@jskit-ai/workspace-console-knex-mysql/repositories/memberships`
- `@jskit-ai/workspace-console-knex-mysql/repositories/invites`
- `@jskit-ai/workspace-console-knex-mysql/repositories/root`
- `@jskit-ai/workspace-console-knex-mysql/repositories/settings`
- `@jskit-ai/workspace-console-knex-mysql/repositories/errorLogs`

Each subpath exports `createRepository(dbClient)`.

## Function reference

### `createConsoleMembershipsRepository(dbClient)`

Repository methods:

- `findByUserId(userId)`
- `findActiveByRoleId(roleId)`
- `listActive()`
- `countActiveMembers()`
- `insert(membership)`
- `ensureActiveByUserId(userId, roleId)`
- `updateRoleByUserId(userId, roleId)`
- `transaction(callback)`

Practical example:

- bootstrap first console member as `console` role, then list all active admins in UI.

### `createConsoleInvitesRepository(dbClient)`

Repository methods:

- `insert(invite)`
- `listPending()`
- `listPendingByEmail(email)`
- `findPendingById(id)`
- `findPendingByTokenHash(tokenHash)`
- `updateStatusById(id, status)`
- `revokeById(id)`
- `markAcceptedById(id)`
- `expirePendingByEmail(email)`
- `deleteArtifactsOlderThan(cutoffDate, batchSize)`
- `transaction(callback)`

Practical example:

- when sending a new invite to an email, old expired pending invites are marked and later cleaned by retention.

### `createConsoleRootRepository(dbClient)`

Repository methods:

- `find()`
- `findRootUserId()`
- `assignRootUserIdIfUnset(userId)`

Practical example:

- first active console super-user gets pinned as immutable root identity.

### `createConsoleSettingsRepository(dbClient)`

Repository methods:

- `find()`
- `ensure()`
- `update(patch)`

Practical example:

- toggle console feature flags in one global settings row.

### `createConsoleErrorLogsRepository(dbClient)`

Repository methods:

- browser errors:
  - `insertBrowserError(entry)`
  - `countBrowserErrors()`
  - `listBrowserErrors(page, pageSize)`
  - `getBrowserErrorById(errorId)`
  - `deleteBrowserErrorsOlderThan(cutoffDate, batchSize)`
- server errors:
  - `insertServerError(entry)`
  - `countServerErrors()`
  - `listServerErrors(page, pageSize)`
  - `getServerErrorById(errorId)`
  - `deleteServerErrorsOlderThan(cutoffDate, batchSize)`
- shared:
  - `transaction(callback)`

Practical example:

- console error explorer lists paginated browser/server failures for operators.

## Practical usage example

```js
import {
  createRepository as createConsoleInvitesRepository
} from "@jskit-ai/workspace-console-knex-mysql/repositories/invites";

const consoleInvitesRepository = createConsoleInvitesRepository(knex);
const pending = await consoleInvitesRepository.listPendingByEmail("admin@example.com");
```

## How `jskit-value-app` uses it and why

Real usage:

- `apps/jskit-value-app/server/runtime/repositories.js`
- `apps/jskit-value-app/tests/consoleErrorLogsRepository.test.js`
- `apps/jskit-value-app/tests/consoleRootSecurity.test.js`

Why:

- console service layer gets focused repository contracts
- retention cleanup uses the same repositories (`delete...OlderThan`/`deleteArtifactsOlderThan`)
- all console DB mapping and date normalization stays centralized

## Non-goals

- no permission checks (service layer handles access control)
- no HTTP request handling
- no frontend formatting concerns
