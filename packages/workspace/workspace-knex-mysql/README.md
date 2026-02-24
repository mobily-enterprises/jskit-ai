# @jskit-ai/workspace-knex-mysql

Knex/MySQL repositories for workspaces, memberships, settings, and invites.

## What this package is for

Use this package as the persistence layer for workspace domain operations:

- create/update/list workspaces
- manage membership roles and status
- manage workspace settings JSON flags/policy
- manage workspace invite lifecycle
- run retention cleanup for old invite artifacts

## Key terms (plain language)

- `workspace membership`: relation between a user and a workspace role/status.
- `workspace settings`: per-workspace feature/policy fields.
- `invite artifact`: processed invite row kept for history and later retention cleanup.

## Exports

Package aliases:

- `createWorkspacesRepository`
- `createWorkspaceMembershipsRepository`
- `createWorkspaceSettingsRepository`
- `createWorkspaceInvitesRepository`

Direct subpaths:

- `@jskit-ai/workspace-knex-mysql/repositories/workspaces`
- `@jskit-ai/workspace-knex-mysql/repositories/memberships`
- `@jskit-ai/workspace-knex-mysql/repositories/settings`
- `@jskit-ai/workspace-knex-mysql/repositories/invites`

Each subpath exports `createRepository(dbClient)`.

## Function reference

### `createWorkspacesRepository(dbClient)`

Methods:

- `findById(id)`
- `findBySlug(slug)`
- `findPersonalByOwnerUserId(ownerUserId, { forUpdate })`
- `insert(workspace)`
- `updateById(id, patch)`
- `listByUserId(userId)`
- `transaction(callback)`

Practical example:

- provisioning personal workspace for a new user with unique slug, then listing all accessible workspaces.

### `createWorkspaceMembershipsRepository(dbClient)`

Methods:

- `findByWorkspaceIdAndUserId(workspaceId, userId)`
- `listByUserIdAndWorkspaceIds(userId, workspaceIds)`
- `insert(membership)`
- `ensureOwnerMembership(workspaceId, userId)`
- `listByUserId(userId)`
- `listActiveByWorkspaceId(workspaceId)`
- `updateRoleByWorkspaceIdAndUserId(workspaceId, userId, roleId)`
- `ensureActiveByWorkspaceIdAndUserId(workspaceId, userId, roleId)`

Practical example:

- accepting an invite ensures active membership and role assignment in one operation.

### `createWorkspaceSettingsRepository(dbClient)`

Methods:

- `findByWorkspaceId(workspaceId)`
- `findByWorkspaceIds(workspaceIds)`
- `ensureForWorkspaceId(workspaceId, defaults)`
- `updateByWorkspaceId(workspaceId, patch)`

Practical example:

- admin toggles invites for one workspace; service persists partial patch in settings row.

### `createWorkspaceInvitesRepository(dbClient)`

Methods:

- `insert(invite)`
- `listPendingByWorkspaceId(workspaceId)`
- `listPendingByWorkspaceIdWithWorkspace(workspaceId)`
- `listPendingByEmail(email)`
- `findById(id)`
- `findPendingByWorkspaceIdAndEmail(workspaceId, email)`
- `findPendingByIdForWorkspace(inviteId, workspaceId)`
- `findPendingByTokenHash(tokenHash)`
- `updateStatusById(id, status)`
- `revokeById(id)`
- `markAcceptedById(id)`
- `markExpiredPendingInvites()`
- `expirePendingByWorkspaceIdAndEmail(workspaceId, email)`
- `deleteArtifactsOlderThan(cutoffDate, batchSize)`
- `transaction(callback)`

Practical example:

- create invite token hash row, accept invite, then retention later deletes old accepted rows.

## Practical usage example

```js
import { createRepository as createWorkspaceInvitesRepository } from
  "@jskit-ai/workspace-knex-mysql/repositories/invites";

const invitesRepository = createWorkspaceInvitesRepository(knex);
const invites = await invitesRepository.listPendingByWorkspaceId(55);
```

## How `jskit-value-app` uses it and why

Real usage:

- `apps/jskit-value-app/server/runtime/repositories.js`
- `apps/jskit-value-app/tests/workspaceRepositories.test.js`

Why:

- workspace service modules depend on stable data contracts instead of raw SQL
- shared date mapping and duplicate handling reduce subtle behavior drift

## Non-goals

- no role/permission policy evaluation
- no HTTP validation/serialization
- no queue/worker orchestration
