# @jskit-ai/workspace-console-core

Shared workspace and console policy primitives for role catalogs, workspace settings patch parsing, and membership access normalization.

## What this package is for

Use this package when you need reusable policy logic for:

- workspace role descriptors and assignable role ids
- workspace color validation/coercion
- workspace settings patch parsing and field-level validation
- membership normalization for access checks
- console role and permission catalog utilities

This keeps policy behavior consistent across services and tests.

## What this package is not for

- No database queries.
- No HTTP route handlers.
- No app-specific UI behavior.
- No per-product permission decisions outside shared catalog primitives.

## Exports

- `@jskit-ai/workspace-console-core`
- `@jskit-ai/workspace-console-core/workspaceAccess`
- `@jskit-ai/workspace-console-core/workspaceRoleCatalog`
- `@jskit-ai/workspace-console-core/workspaceSettingsPatch`
- `@jskit-ai/workspace-console-core/workspaceColors`
- `@jskit-ai/workspace-console-core/consoleRoles`

## Function and constant reference

### `workspaceColors`

- `isWorkspaceColor(value)`
  - Returns true only for 6-digit hex colors like `#0F6B54`.
  - Example: reject `green` and accept `#00AA44` in workspace settings form.
- `coerceWorkspaceColor(value)`
  - Returns uppercase valid color or default color.
  - Example: if DB row has invalid value, map to safe default for rendering.

Related constants:

- `DEFAULT_WORKSPACE_COLOR`
- `WORKSPACE_COLOR_PATTERN`

### `workspaceRoleCatalog`

- `toRoleDescriptor(roleId, role)`
  - Builds normalized role descriptor (`id`, `assignable`, unique permissions).
  - Example: transform RBAC manifest role entries to API-safe objects.
- `listRoleDescriptors(rbacManifest)`
  - Lists normalized roles from manifest and sorts owner role first.
  - Example: workspace admin page can display role catalog in stable order.
- `resolveAssignableRoleIds(rbacManifest)`
  - Returns role ids that can be assigned by admins (excluding owner).
  - Example: invite form role dropdown only shows assignable roles.

### `workspaceSettingsPatch`

- `createWorkspaceSettingsPatchPolicy(dependencies?)`
  - Factory that injects:
    - validation error creator
    - email normalizer
    - color validator
    - transcript mode allowlist
    - assistant prompt max length
  - Returns `{ parseWorkspaceSettingsPatch }`.
  - Example: each app can plug in its own `AppError` class while reusing the exact same patch parsing logic.

- `parseWorkspaceSettingsPatch(payload)` (returned method)
  - Parses request payload into:
    - `workspacePatch`
    - `settingsPatch`
    - `fieldErrors`
  - Handles name, avatar URL, color, invites flag, transcript mode, assistant prompt, app deny lists.
  - Example: PATCH request can update workspace display color and deny-list emails in one request with clear field-level errors.

### `workspaceAccess`

- `resolveMembershipRoleId(membershipLike)`
  - Extracts normalized role id.
  - Example: role checks can handle noisy input safely.
- `resolveMembershipStatus(membershipLike)`
  - Resolves status with fallback to `active`.
  - Example: supports both `status` and `membershipStatus` shapes.
- `normalizeMembershipForAccess(membershipLike)`
  - Returns only active membership summaries, else `null`.
  - Example: pending invites do not count for authorization.
- `mapMembershipSummary(membershipLike)`
  - Alias used for mapping response summaries.
  - Example: membership list API returns only active memberships with one shared rule path.
- `normalizePermissions(value)`
  - Deduplicates and trims permission arrays.
  - Example: avoids duplicate permission checks and noisy payloads.
- `createMembershipIndexes(memberships)`
  - Builds `byId` and `bySlug` maps for quick membership lookups.
  - Example: request with workspace slug can be resolved quickly to membership row.

### `consoleRoles`

- `normalizeRoleId(roleId)`
  - Lowercases and trims role ids.
  - Example: ` DevOp ` becomes `devop`.
- `resolveRolePermissions(roleId)`
  - Returns permissions for a console role id.
  - Example: controller checks whether role can read server errors.
- `resolveAssignableRoleIds()`
  - Returns assignable console role ids.
  - Example: invite management UI restricts role choices.
- `hasPermission(permissionSet, permission)`
  - Checks explicit permission or wildcard `*`.
  - Example: role with `*` passes all console permission checks.
- `getRoleCatalog()`
  - Returns default invite role, role descriptors, and assignable ids.
  - Example: admin UI can render role catalog without knowing internals.

Related constants:

- role ids: `CONSOLE_ROLE_ID`, `DEVOP_ROLE_ID`, `MODERATOR_ROLE_ID`
- permission groups:
  - `CONSOLE_AI_TRANSCRIPTS_PERMISSIONS`
  - `CONSOLE_BILLING_PERMISSIONS`
  - `CONSOLE_ASSISTANT_SETTINGS_PERMISSIONS`
  - `CONSOLE_MANAGEMENT_PERMISSIONS`
- `CONSOLE_ROLE_DEFINITIONS`

## How it is used in apps (real terms, and why)

Current `jskit-value-app` usage:

- direct wrappers:
  - `apps/jskit-value-app/server/domain/workspace/policies/workspaceRoleCatalog.js`
  - `apps/jskit-value-app/server/domain/workspace/policies/workspaceAccess.js`
  - `apps/jskit-value-app/server/domain/console/policies/roles.js`
  - `apps/jskit-value-app/shared/workspace/colors.js`
- injected policy setup:
  - `apps/jskit-value-app/server/domain/workspace/policies/workspaceSettingsPatch.js`

Where behavior is used:

- workspace admin services use role descriptor helpers for role assignment controls
- workspace services use membership indexes/normalization for access checks
- UI/store/mappers use color coercion for consistent workspace theming
- settings patch parser enforces safe, explicit workspace settings updates

Practical patch flow example:

1. Admin submits workspace settings update.
2. `parseWorkspaceSettingsPatch` validates fields and normalizes accepted values.
3. Service applies `workspacePatch` and `settingsPatch` separately to appropriate repositories.
4. UI receives stable, validated workspace and settings state.
