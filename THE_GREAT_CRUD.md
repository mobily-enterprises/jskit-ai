# THE GREAT CRUD

## Purpose
Define and execute a clean, zero-legacy architecture for:
1. Resource CRUD contracts and UI flows.
2. Command contracts and UI flows.
3. Scope-aware composables (`workspace`, `account`, `global`) with shared cores.

This document is the source of truth for the migration.

## Non-Negotiables
1. No backward compatibility layer, no shims, no temporary dual paths.
2. Junior-readable code, explicit contracts, no magic.
3. Reuse shared primitives in modules/kernel when generally useful.
4. No fake CRUD for command endpoints.
5. Server contracts are authoritative; client reads from shared contracts.

## Locked Decisions
1. Scope axis:
   1. `workspace`
   2. `account`
   3. `global`
2. Mode axis:
   1. `add`
   2. `edit`
   3. `list`
   4. `view`
   5. `command`
3. Contract axis:
   1. Resource endpoints use `resource contract`.
   2. Command endpoints use `command contract`.

## Current Status (As Of 2026-03-09)
1. Done:
   1. Added resource contract primitive in `http-runtime`:
      1. `createResourceSchemaContract`
      2. `createCursorPagedListResponseSchema`
   2. Upgraded workspace settings shared schema to full write variants in `users-core`:
      1. `workspaceSettingsCreateSchema`
      2. `workspaceSettingsReplaceSchema`
      3. `workspaceSettingsPatchSchema`
      4. `parseWorkspaceSettingsCreate/Replace/Patch`
   3. Wired `workspaceSettings` resource contract in `users-routes`.
   4. Added tests for above.
   5. Updated add/edit wrapper behavior:
      1. configurable `writeMethod`
      2. function-based `apiSuffix`
      3. configurable `readEnabled`
   6. Added composable cores:
      1. `useAddEditCore`
      2. `useListCore`
      3. `useViewCore`
      4. `useCommandCore`
   7. Added scope wrappers:
      1. `useWorkspaceAddEdit/List/View/Command`
      2. `useAccountAddEdit/List/View/Command`
      3. `useGlobalAddEdit/List/View/Command`
   8. Migrated initial screens to new wrappers:
      1. `WorkspaceSettingsClientElement` -> `useWorkspaceAddEdit`
      2. `templates/console/settings` -> `useGlobalAddEdit`
      3. `templates/admin/members` -> workspace `view/list/command` wrappers
2. Not done:
   1. Full repository-wide resource contract rollout.
   2. Command contract standardization.
   3. Final repository-wide migration to wrappers across all screens.
   4. Remove remaining direct low-level endpoint plumbing in legacy screens.

## Repository Classification

### Resource Contracts (Repository-Backed)
1. `workspaces.repository` -> `workspaceResourceContract`
2. `workspaceSettings.repository` -> `workspaceSettingsResourceContract` (in progress)
3. `memberships.repository` -> `workspaceMemberResourceContract`
4. `workspaceInvites.repository` -> `workspaceInviteResourceContract`
5. `userProfiles.repository` -> `userProfileResourceContract`
6. `userSettings.repository` -> `userSettingsResourceContract`
7. `consoleSettings.repository` -> `consoleSettingsResourceContract`

Each resource contract must include:
1. `record`
2. `create`
3. `replace`
4. `patch`
5. `list` (default: cursor paged list of `record`, override allowed)
6. `required` metadata (`create`, `replace`, `patch`)

### Command Contracts (Not CRUD)
1. `workspace.invite.redeem`
2. `settings.security.password.change`
3. `settings.security.password_method.toggle`
4. `settings.security.oauth.link.start`
5. `settings.security.oauth.unlink`
6. `settings.security.sessions.logout_others`
7. `settings.profile.avatar.upload`
8. `settings.profile.avatar.delete`

Each command contract must include:
1. `input`
2. `output`
3. optional `idempotent`
4. optional `invalidates`

### Borderline Endpoints (Treat As Resource Operations)
1. `workspace.invite.create` / `workspace.invite.revoke` -> workspace invite resource ops.
2. `workspace.member.role.update` -> workspace member patch op.
3. `settings.profile.update`, `settings.preferences.update`, `settings.notifications.update`, `settings.chat.update`, `console.settings.update` -> patch ops on respective resources.

## Target Composable Architecture

### Shared Cores
1. `useAddEditCore`
2. `useListCore`
3. `useViewCore`
4. `useCommandCore`

Core intent:
1. `useAddEditCore`: load existing record (for edit), validate/submit payload, map field errors/message state.
2. `useListCore`: list fetch + refresh + pagination/load-more + list error state.
3. `useViewCore`: single-record read flow (read-only), not-found/error/loading/refetch state.
4. `useCommandCore`: command submission flow (non-resource writes), command validation/message/error state.

### Scope Wrappers
1. Workspace:
   1. `useWorkspaceAddEdit`
   2. `useWorkspaceList`
   3. `useWorkspaceView`
   4. `useWorkspaceCommand`
2. Account:
   1. `useAccountAddEdit`
   2. `useAccountList`
   3. `useAccountView`
   4. `useAccountCommand`
3. Global:
   1. `useGlobalAddEdit`
   2. `useGlobalList`
   3. `useGlobalView`
   4. `useGlobalCommand`

### Wrapper Responsibilities
1. Resolve path context for scope.
2. Resolve permission checks for scope.
3. Provide query key conventions for scope.
4. Delegate data flow to core composables.

### View Flow Contract (Mandatory)
Every `use*View` wrapper must expose:
1. `record`: normalized read-only record model.
2. `isLoading`: first load state.
3. `isFetching`: background refresh state.
4. `isNotFound`: explicit 404 state.
5. `loadError`: non-404 load error message.
6. `refresh()`: explicit refetch trigger.
7. `canView`: permission gate result.

Behavior rules:
1. View screens never own endpoint plumbing directly.
2. Route/context changes must trigger a clean re-read.
3. `404` and non-`404` errors are split for predictable UX.
4. View mode is read-only and must not include mutation side effects.

## Stages

## Stage 1: Foundation
Goal: stable primitives and naming for contracts/composables.

Tasks:
1. Composable refactor:
   1. Extract current shared add/edit behavior into `useAddEditCore`.
   2. Implement `useWorkspaceAddEdit`.
   3. Implement `useAccountAddEdit`.
   4. Implement `useGlobalAddEdit`.
2. List primitives:
   1. Extract list behavior into `useListCore`.
   2. Implement scope wrappers (`workspace/account/global`).
3. View primitives:
   1. Extract single-record loading behavior into `useViewCore`.
   2. Implement scope wrappers (`workspace/account/global`).
4. Command primitives:
   1. Implement `createCommandContract` in shared contracts.
   2. Implement `useCommandCore`.
   3. Implement scope wrappers (`workspace/account/global`).
5. Keep existing screen behavior working with new names.

Exit criteria:
1. At least one screen uses `useWorkspaceAddEdit`.
2. At least one non-workspace screen uses `useAccountAddEdit` or `useGlobalAddEdit`.
3. View wrapper exists and is used by at least one existing view screen.
4. Command wrapper exists and is used by at least one existing command screen.
5. Tests pass for touched packages.

Status: `COMPLETED`

## Stage 2: Contract Rollout
Goal: every repository-backed resource has a mandatory resource contract; command endpoints have command contracts.

Tasks:
1. Add all resource contracts listed in this file.
2. Route schemas consume those contracts directly.
3. Add command contracts for the command endpoint list.
4. Add strict tests:
   1. fail if a listed resource contract is missing required keys.
   2. fail if listed command endpoints lack command contracts.

Exit criteria:
1. All 7 resource contracts exist and are wired in routes.
2. All 8 command contracts exist and are wired in routes.
3. Tests enforce this (not convention-only).

Status: `IN PROGRESS`

## Stage 3: UI Migration + Cleanup
Goal: all existing relevant screens use scope wrappers + shared cores, and old patterns are removed.

Tasks:
1. Migrate workspace screens to `useWorkspaceAddEdit` and `useWorkspaceList`.
2. Migrate workspace view screens to `useWorkspaceView`.
3. Migrate account settings screens to `useAccountAddEdit` / `useAccountView` / `useAccountCommand`.
4. Migrate global-like screens to `useGlobal*` (including `useGlobalView`).
5. Remove deprecated composables/patterns.
6. Update docs/template references.

Exit criteria:
1. No screen manually reimplements standard add/edit/list/view/command plumbing.
2. No deprecated wrappers remain.
3. Tests and smoke checks pass.

Status: `NOT STARTED`

## Progress Log
1. 2026-03-09:
   1. Created this plan.
   2. Added resource contract primitive (`http-runtime`).
   3. Applied full write resource contract pattern to workspace settings.
   4. Added tests for contract utility and initial resource contract wiring.
   5. Elevated `view` to first-class planning scope (core + wrappers + migration contract).
   6. Implemented `useAddEditCore`, `useListCore`, `useViewCore`, `useCommandCore` and scope wrappers (`workspace/account/global`).
   7. Migrated initial users-web screens/templates to wrapper-based flows (workspace settings, console settings, workspace members).
