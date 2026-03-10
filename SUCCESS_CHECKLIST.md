# Users-Routes Server Split Success Checklist

## Scope

This checklist is for **server-side `users-routes` only**.

Included in scope:
- `packages/users-routes/src/server/**`
- server-side route contract helpers currently used by those routes
- package exports/descriptor/test updates needed because the server route files move

Not in scope for this checklist:
- `users-core` action/service/schema extraction
- `users-web` client extraction
- changing route semantics unless the split requires it

## Target Rule

`UsersRouteServiceProvider.js` must become a thin glue provider that only wires feature route builders.

Target shape:

```js
registerWorkspaceBootstrapRoutes(app);
registerWorkspaceDirectoryRoutes(app);
registerWorkspacePendingInvitationsRoutes(app);
registerWorkspaceSettingsRoutes(app);
registerWorkspaceMembersRoutes(app);
registerAccountProfileRoutes(app);
registerAccountPreferencesRoutes(app);
registerAccountNotificationsRoutes(app);
registerAccountChatRoutes(app);
registerAccountSecurityRoutes(app);
registerConsoleSettingsRoutes(app);
```

No inline route blocks in `UsersRouteServiceProvider.js`.
No `registerRoute(...)` wrapper.
No action ID maps in the provider.

## Target Server Directory Shape

```text
packages/users-routes/src/server/
  common/
    support/
      routeParams.js
      routeQueries.js
      routeResponses.js
  providers/
    UsersRouteServiceProvider.js

  workspaceBootstrap/
    WorkspaceBootstrapController.js

  workspaceDirectory/
    WorkspaceDirectoryController.js

  workspacePendingInvitations/
    WorkspacePendingInvitationsController.js

  workspaceSettings/
    WorkspaceSettingsController.js

  workspaceMembers/
    WorkspaceMembersController.js

  accountProfile/
    AccountProfileController.js

  accountPreferences/
    AccountPreferencesController.js

  accountNotifications/
    AccountNotificationsController.js

  accountChat/
    AccountChatController.js

  accountSecurity/
    AccountSecurityController.js

  consoleSettings/
    ConsoleSettingsController.js
```

## Shared Server-Side Transport Pieces To Move First

### 1. Move `routeParams` into server common

Current file:
- `packages/users-routes/src/shared/contracts/routeParams.js`

Target file:
- `packages/users-routes/src/server/common/support/routeParams.js`

Why:
- these are route-side transport contract parts
- they are server-only
- they are shared by multiple route slices

Keep this exact rule:
- params remain **optional in the shared schema object**
- URL path makes them required by presence in the route pattern
- example:
  - `params: [routeParams.workspaceSlug, routeParams.memberUserId]`
  - `workspaceSlug` and `memberUserId` are optional in the shared schema, but mandatory for that route because both appear in the URL

Do not change this behavior.

Shared param parts that must survive the move:
- `workspaceSlug`
- `memberUserId`
- `inviteId`
- `provider`

### 2. Move `routeQueries` into server common

Current file:
- `packages/users-routes/src/shared/contracts/routeQueries.js`

Target file:
- `packages/users-routes/src/server/common/support/routeQueries.js`

Keep these shared query contract parts:
- `pagination`
- `search`
- `oauthReturnTo`
- `workspaceBootstrap`

### 3. Create a shared response helper in server common

Current provider-local helper:
- `buildWorkspaceResponse(...)` in `UsersRouteServiceProvider.js`

Target file:
- `packages/users-routes/src/server/common/support/routeResponses.js`

Move only genuinely shared route-side response helpers there.

Likely contents:
- `buildWorkspaceResponse(...)`

Do not move feature-specific response shaping there.

### 4. Delete the route wrapper helper

Current provider-local wrapper:
- `registerRoute(router, route)` in `UsersRouteServiceProvider.js`

Action:
- delete it
- every feature route file should call `router.register(...)` directly

### 5. Remove shared action ID maps from the provider

Current provider-local constant maps:
- `WORKSPACE_ACTION_IDS`
- `SETTINGS_ACTION_IDS`
- `CONSOLE_SETTINGS_ACTION_IDS`

Action:
- remove them from `UsersRouteServiceProvider.js`
- feature route files should use explicit action ids directly, the same way `workspaceSettings` now does

## Slice 1: `workspaceBootstrap`

### Routes owned by this slice
- `GET /api/bootstrap`

### New file
- `packages/users-routes/src/server/workspaceBootstrap/WorkspaceBootstrapController.js`

### What must move out of `UsersRouteServiceProvider.js`
- route block currently starting at `/api/bootstrap`
- OAuth provider catalog shaping
- session cookie write/clear logic
- optional `consoleService.ensureInitialConsoleMember(...)`
- bootstrap workspace slug extraction from query

### Shared imports this slice will need
- `KERNEL_TOKENS.HttpRouter`
- `withStandardErrorResponses`
- `routeQueries.workspaceBootstrap` from server common
- likely `buildWorkspaceResponse(...)` from server common, if still used
- `authService` and optional `consoleService` via `app.make(...)` inside the slice register function

### Contracts
Current response source:
- `workspaceSchema.response.bootstrap`

Checklist:
- decide whether this stays temporarily in `workspaceRoutesContract` for this pass
- if it stays, import only the bootstrap contract into this slice
- do not leave bootstrap contract knowledge buried in the provider

### Register function target
- export `registerWorkspaceBootstrapRoutes(app)`

### Provider change
- import `registerWorkspaceBootstrapRoutes`
- call it from `UsersRouteServiceProvider.boot(app)`
- remove the old inline block

### Verification
- route still registers `GET /api/bootstrap`
- session cookie behavior unchanged
- `request.executeAction({ actionId: "workspace.bootstrap.read" })` still receives the same inputs

## Slice 2: `workspaceDirectory`

### Routes owned by this slice
- `GET /api/workspaces`

### New file
- `packages/users-routes/src/server/workspaceDirectory/WorkspaceDirectoryController.js`

### What must move out of `UsersRouteServiceProvider.js`
- route block for `/api/workspaces`

### Dependencies
- just `router`
- no `authService`
- no `consoleService`

### Contracts
Current response source:
- `workspaceSchema.response.workspacesList`

Checklist:
- keep response contract import local to this slice
- use shared `buildWorkspaceResponse(...)` only if that helper survives as a real shared route response helper

### Register function target
- export `registerWorkspaceDirectoryRoutes(app)`

### Verification
- route still executes `workspace.workspaces.list`
- no behavior changes

## Slice 3: `workspacePendingInvitations`

### Routes owned by this slice
- `GET /api/workspace/invitations/pending`
- `POST /api/workspace/invitations/redeem`

### New file
- `packages/users-routes/src/server/workspacePendingInvitations/WorkspacePendingInvitationsController.js`

### What must move out of `UsersRouteServiceProvider.js`
- pending invites list route block
- invite redeem route block

### Shared imports this slice will need
- `normalizeObjectInput` only if the redeem body still needs route-level body normalization
- workspace response helper if still shared

### Contracts
Current sources:
- `workspaceSchema.response.pendingInvites`
- `workspaceSchema.body.redeemInvite`
- `workspaceSchema.response.respondToInvite`

Checklist:
- keep both routes together in one slice
- do not merge them into `workspaceMembers`; they are user-level pending invite inbox routes

### Register function target
- export `registerWorkspacePendingInvitationsRoutes(app)`

### Verification
- list route still executes `workspace.invitations.pending.list`
- redeem route still executes `workspace.invite.redeem`
- request body normalization still reaches `request.input.body`

## Slice 4: `workspaceSettings`

### Routes owned by this slice
- `GET /api/w/:workspaceSlug/workspace/settings`
- `PATCH /api/w/:workspaceSlug/workspace/settings`
- `GET /api/admin/w/:workspaceSlug/workspace/settings`
- `PATCH /api/admin/w/:workspaceSlug/workspace/settings`

### Current file
- `packages/users-routes/src/server/controllers/WorkspaceSettingsController.js`

### Target move
- move it into:
  - `packages/users-routes/src/server/workspaceSettings/WorkspaceSettingsController.js`

### What must stay true
- explicit `router.register(...)`
- direct action ids
- `params: routeParams.workspaceSlug`
- `body: workspaceSettingsSchema.operations.patch.body`
- no route wrapper
- no controller class
- no workspace context resolution in routes

### Additional required updates
- update imports in `UsersRouteServiceProvider.js`
- update `packages/users-routes/src/server/index.js`
- update any tests or package exports using the old file path

### Verification
- all four workspace settings routes still register
- imports point at new folder location only

## Slice 5: `workspaceMembers`

### Routes owned by this slice
App surface:
- `GET /api/w/:workspaceSlug/workspace/roles`
- `GET /api/w/:workspaceSlug/workspace/members`
- `PATCH /api/w/:workspaceSlug/workspace/members/:memberUserId/role`
- `GET /api/w/:workspaceSlug/workspace/invites`
- `POST /api/w/:workspaceSlug/workspace/invites`
- `DELETE /api/w/:workspaceSlug/workspace/invites/:inviteId`

Admin surface:
- `GET /api/admin/w/:workspaceSlug/workspace/roles`
- `GET /api/admin/w/:workspaceSlug/workspace/members`
- `PATCH /api/admin/w/:workspaceSlug/workspace/members/:memberUserId/role`
- `GET /api/admin/w/:workspaceSlug/workspace/invites`
- `POST /api/admin/w/:workspaceSlug/workspace/invites`
- `DELETE /api/admin/w/:workspaceSlug/workspace/invites/:inviteId`

### New file
- `packages/users-routes/src/server/workspaceMembers/WorkspaceMembersController.js`

### Why this is one slice
- role catalog
- members list
- member role update
- workspace-admin invite management
all belong to workspace administration for a selected workspace

### What must move out of `UsersRouteServiceProvider.js`
- all route blocks from workspace roles through admin invite revoke

### Shared imports this slice will need
- `routeParams.workspaceSlug`
- `routeParams.memberUserId`
- `routeParams.inviteId`
- shared workspace response helper if kept

### Param schema rule to preserve
For:
- `/api/w/:workspaceSlug/workspace/members/:memberUserId/role`

keep:
```js
params: [routeParams.workspaceSlug, routeParams.memberUserId]
```

Explanation:
- both param parts stay optional in the shared schema object
- the URL path makes both required for that route
- do not replace this with a one-off merged schema in the feature file unless there is a new route-only requirement

Same idea for invite revoke:
```js
params: [routeParams.workspaceSlug, routeParams.inviteId]
```

### Slice-local helper
Current local helper:
- `normalizeMemberRoleBody(...)`

Checklist:
- move this helper into the `workspaceMembers` slice file if still needed
- do not put it in `common/support` unless another slice actually uses it

### Contracts
Current sources:
- `workspaceSchema.response.roles`
- `workspaceSchema.response.members`
- `workspaceSchema.response.invites`
- `workspaceSchema.body.memberRoleUpdate`
- `workspaceSchema.body.createInvite`

Checklist:
- keep these imports local to this slice
- do not leave any of these references in the glue provider

### Register function target
- export `registerWorkspaceMembersRoutes(app)`

### Verification
- all 12 routes still register
- param arrays still use shared optional param contract parts
- app/admin surfaces still map correctly

## Slice 6: `accountProfile`

### Routes owned by this slice
- `GET /api/settings`
- `PATCH /api/settings/profile`
- `POST /api/settings/profile/avatar`
- `DELETE /api/settings/profile/avatar`

### New file
- `packages/users-routes/src/server/accountProfile/AccountProfileController.js`

### Why these belong together
- they all drive the same account profile page and avatar workflow
- they are not preferences, notifications, chat, or security

### What must move out of `UsersRouteServiceProvider.js`
- settings read route
- profile update route
- avatar upload route
- avatar delete route

### Dependencies
- this slice will still need `authService` for session cookie writes
- keep that dependency local to the slice register function

### Contracts
Current sources:
- `settingsSchema.response`
- `settingsSchema.body.profile`
- `settingsSchema.commands["settings.profile.avatar.upload"]`
- `settingsSchema.commands["settings.profile.avatar.delete"]`

Checklist:
- keep multipart upload handling in this slice
- keep avatar file validation here
- do not mix account preferences/security routes into this file

### Register function target
- export `registerAccountProfileRoutes(app)`

### Verification
- settings read still calls `settings.read`
- profile update still writes cookies when session is returned
- avatar upload/delete routes still work

## Slice 7: `accountPreferences`

### Routes owned by this slice
- `PATCH /api/settings/preferences`

### New file
- `packages/users-routes/src/server/accountPreferences/AccountPreferencesController.js`

### What must move out of `UsersRouteServiceProvider.js`
- preferences route block only

### Contracts
Current sources:
- `settingsSchema.body.preferences`
- `settingsSchema.response`

### Register function target
- export `registerAccountPreferencesRoutes(app)`

### Verification
- still executes `settings.preferences.update`

## Slice 8: `accountNotifications`

### Routes owned by this slice
- `PATCH /api/settings/notifications`

### New file
- `packages/users-routes/src/server/accountNotifications/AccountNotificationsController.js`

### Contracts
Current sources:
- `settingsSchema.body.notifications`
- `settingsSchema.response`

### Register function target
- export `registerAccountNotificationsRoutes(app)`

### Verification
- still executes `settings.notifications.update`

## Slice 9: `accountChat`

### Routes owned by this slice
- `PATCH /api/settings/chat`

### New file
- `packages/users-routes/src/server/accountChat/AccountChatController.js`

### Contracts
Current sources:
- `settingsSchema.body.chat`
- `settingsSchema.response`

### Register function target
- export `registerAccountChatRoutes(app)`

### Verification
- still executes `settings.chat.update`

## Slice 10: `accountSecurity`

### Routes owned by this slice
- `POST /api/settings/security/change-password`
- `PATCH /api/settings/security/methods/password`
- `GET /api/settings/security/oauth/:provider/start`
- `DELETE /api/settings/security/oauth/:provider`
- `POST /api/settings/security/logout-others`

### New file
- `packages/users-routes/src/server/accountSecurity/AccountSecurityController.js`

### What must move out of `UsersRouteServiceProvider.js`
- all settings security route blocks

### Shared imports this slice will need
- `routeParams.provider`
- `routeQueries.oauthReturnTo`
- `normalizeObjectInput` only where still needed
- `normalizeText` only where still needed for provider/returnTo extraction

### Param/query schema rule to preserve
For OAuth start:
```js
params: routeParams.provider,
query: routeQueries.oauthReturnTo
```

Keep the shared optional contract parts.
The route path/query usage decides what is actually present.

### Dependencies
- this slice still needs `authService` only for the password-change cookie write path
- keep that local to this slice register function

### Register function target
- export `registerAccountSecurityRoutes(app)`

### Verification
- rate limits remain attached to the same routes
- redirect route still sends `reply.redirect(...)`
- cookie write on password change still works

## Slice 11: `consoleSettings`

### Routes owned by this slice
- `GET /api/console/settings`
- `PATCH /api/console/settings`

### Current legacy file
- `packages/users-routes/src/server/controllers/UsersConsoleSettingsController.js`

### New file
- `packages/users-routes/src/server/consoleSettings/ConsoleSettingsController.js`

### What must move out of `UsersRouteServiceProvider.js`
- both console settings route blocks

### Contracts
Current sources:
- `consoleSettingsSchema.response.settings`
- `consoleSettingsSchema.body.update`

Checklist:
- keep this slice small and explicit like `workspaceSettings`
- use direct action ids in the route file
- no class controller

### Register function target
- export `registerConsoleSettingsRoutes(app)`

### Verification
- still executes `console.settings.read` and `console.settings.update`

## Glue Provider Checklist

File:
- `packages/users-routes/src/server/providers/UsersRouteServiceProvider.js`

### Required final changes
- remove all inline route blocks
- remove `registerRoute(...)`
- remove all action-id constant maps
- remove route-local helpers that moved into slices or common support
- import only the feature route builder functions
- call only those route builder functions in `boot(app)`

### Desired final body
- obtain nothing except what is genuinely still needed globally
- ideally just call feature registration functions
- if a feature needs `authService` or `consoleService`, that feature route file should resolve it itself

## Server Exports Checklist

File:
- `packages/users-routes/src/server/index.js`

### Required changes
- stop exporting legacy flat controllers:
  - `UsersWorkspaceController`
  - `UsersSettingsController`
  - `UsersConsoleSettingsController`
- export the feature route builders from their new folders
- keep `UsersRouteServiceProvider` export

## Descriptor Checklist

File:
- `packages/users-routes/package.descriptor.mjs`

### Required changes
- update API summary text if it still describes old flat controllers
- keep the route metadata list accurate
- if server exports mentioned in metadata move, update the summary to reflect feature-first route builders

## Test Checklist

### Primary test file
- `packages/users-routes/test/requestInputContract.test.js`

### Required updates
- update imports if they reference moved route/controller files
- keep assertions for the same registered paths
- keep assertions for request input contract behavior
- add or update tests so each extracted route file is still exercised indirectly through the provider

### Additional package tests to review
- `packages/users-routes/test/resourceContracts.test.js`

Checklist:
- if route contract helper files move from `src/shared/contracts` to server common, update tests/imports accordingly
- ensure resource contract tests still point at the canonical schemas they are meant to verify

## Legacy Cleanup Checklist

After all feature files are in place and tests pass:
- delete unused flat controller files from `packages/users-routes/src/server/controllers/`
- delete any dead provider-local helpers
- delete old imports from `UsersRouteServiceProvider.js`
- remove any empty obsolete directories if they are no longer part of the target structure

Do not delete legacy files until all imports, exports, tests, and provider wiring point at the new feature locations.

## Success Conditions

This split is complete only when all of these are true:
- `UsersRouteServiceProvider.js` is a glue file of `register*Routes(app)` calls
- every route block lives in exactly one feature folder
- shared route transport parts live in `server/common/support`
- the optional shared param schema trick is preserved for combined route params
- no feature route builder lives in `common/support`
- no dead flat controller exports remain
- route tests still pass with the new file layout
