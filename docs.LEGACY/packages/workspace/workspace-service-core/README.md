# @jskit-ai/workspace-service-core

Workspace domain service-layer primitives for user workspace context, workspace admin management, and invite email delivery.

## What this package is for

Use this package to implement workspace business flows, including:

- resolving active workspace context from request/user state
- personal workspace bootstrap in personal-tenancy mode
- workspace admin settings/member/invite management
- workspace invite email composition and delivery contract
- shared policy/mapping helpers for workspace APIs

## Key terms (plain language)

- `tenancy mode`: how many workspaces a user can use (`personal`, `team-single`, `multi-workspace`).
- `workspace context`: the selected workspace + membership + permissions for one request.
- `surface`: client area making the request (`app`, `admin`, `console`).

## Exports and import guidance

Subpath imports are recommended:

- `@jskit-ai/workspace-service-core/services/workspace`
- `@jskit-ai/workspace-service-core/services/admin`
- `@jskit-ai/workspace-service-core/services/inviteEmail`
- `@jskit-ai/workspace-service-core/policies/workspaceNaming`
- `@jskit-ai/workspace-service-core/policies/workspacePolicyDefaults`
- `@jskit-ai/workspace-service-core/policies/workspaceSettingsPatch`
- `@jskit-ai/workspace-service-core/policies/workspaceInvitePolicy`
- `@jskit-ai/workspace-service-core/mappers/workspaceMappers`
- `@jskit-ai/workspace-service-core/mappers/workspaceAdminMappers`
- `@jskit-ai/workspace-service-core/lookups/workspaceMembershipLookup`
- `@jskit-ai/workspace-service-core/lookups/workspaceRequestContext`

`__testables` is exported for tests (mainly from `inviteEmail`).

## Function reference

### Policies

#### `workspaceNaming`

- `toSlugPart(value)`
  - slugifies text to lowercase dash-separated ID piece.
  - Example: `"Merc Team" -> "merc-team"`.
- `buildWorkspaceName(userProfile)`
  - builds default workspace name from display name/email.
  - Example: `"Casey Workspace"`.
- `buildWorkspaceBaseSlug(userProfile)`
  - builds base slug seed for unique slug generation.
  - Example: `"casey"` then service may create `casey-2` if needed.

#### `workspacePolicyDefaults`

- `createWorkspaceSettingsDefaults(invitesEnabled?)`
  - creates initial settings object with default AI transcript mode.
  - Example: used when first creating workspace settings row.

#### `workspaceSettingsPatch`

- `parseWorkspaceSettingsPatch(payload)`
  - validates and normalizes admin settings patch input.
  - returns parsed patches + field errors.
  - Example: admin PATCH body updates invites flag, workspace color, deny lists.

#### `workspaceInvitePolicy`

- `DEFAULT_INVITE_EXPIRY_DAYS`
- `resolveInviteExpiresAt(inviteExpiryDays?)`
  - returns invite expiration ISO timestamp.
  - Example: 7-day invite expiration for workspace invites.

### Mappers

#### `workspaceMappers`

- `normalizeWorkspaceColor(value)`
- `mapWorkspaceMembershipSummary(workspaceRow, options)`
- `mapWorkspaceAdminSummary(workspace)`
- `mapWorkspaceSettingsPublic(workspaceSettings, options)`
- `mapUserSettingsPublic(userSettings)`
- `mapPendingInviteSummary(invite)`

Practical example:

- build bootstrap payload with stable workspace cards, settings, and pending invites.

#### `workspaceAdminMappers`

- `mapWorkspaceSettingsResponse(workspace, workspaceSettings, options)`
- `mapWorkspaceMemberSummary(member, workspace)`
- `mapWorkspaceInviteSummary(invite)`
- `mapWorkspacePayloadSummary(workspace)`

Practical example:

- workspace admin panel receives normalized response with role catalog + settings + members.

### Lookups

#### `workspaceMembershipLookup`

- `collectInviteWorkspaceIds(invites)`
  - extracts unique workspace ids from invite list.
- `listInviteMembershipsByWorkspaceId({ workspaceMembershipsRepository, userId, invites })`
  - bulk (or fallback single) lookup of existing memberships for invited user.

Practical example:

- hide invites for workspaces where user is already active member.

#### `workspaceRequestContext`

- `resolveRequestSurfaceId(request, preferredSurfaceId?, options?)`
  - resolves surface from explicit arg, header, or request pathname.
- `resolveRequestedWorkspaceSlug(request)`
  - resolves desired workspace slug from header/query/params.

Practical example:

- API request carries `x-workspace-slug`, service selects that workspace safely.

### Services

#### `services/inviteEmail`

- `createService(options)` returns:
  - `sendWorkspaceInviteEmail(payload)`

Behavior:

- validates recipient email
- builds workspace-invite subject/text in one place
- delegates delivery through injected email sender (`sendEmail` or `communicationsService.sendEmail`)
- returns normalized delivery metadata (`delivered`, `reason`, provider/message id when available)

Practical example:

- invite creation flow can attempt email delivery without breaking invite creation when delivery is unavailable.

#### `services/admin`

- `createService(deps)` returns:
  - `getRoleCatalog()`
  - `getWorkspaceSettings(workspaceContext, options?)`
  - `updateWorkspaceSettings(workspaceContext, payload)`
  - `listMembers(workspaceContext)`
  - `updateMemberRole(workspaceContext, payload)`
  - `listInvites(workspaceContext)`
  - `createInvite(workspaceContext, actorUser, payload)`
  - `revokeInvite(workspaceContext, inviteId)`
  - `listPendingInvitesForUser(user)`
  - `respondToPendingInviteByToken({ user, inviteToken, decision })`

Practical example:

- workspace owner invites teammate, teammate accepts invite token, membership is created and last active workspace updates.

#### `services/workspace`

- `createService(deps)` returns:
  - `ensurePersonalWorkspaceForUser(userProfile)`
  - `resolveRequestContext({ user, request, workspacePolicy, workspaceSurface })`
  - `buildBootstrapPayload({ request, user })`
  - `selectWorkspaceForUser(user, workspaceSelector, options?)`
  - `listWorkspacesForUser(user, options?)`
  - `listPendingInvitesForUser(userProfile)`
  - `resolvePermissions(roleId)`

Practical example:

- on login bootstrap, service ensures personal workspace (if required), resolves current workspace, permissions, settings, avatar response, and pending invites.

## Practical usage example

```js
import { createService as createWorkspaceService } from
  "@jskit-ai/workspace-service-core/services/workspace";

const workspaceService = createWorkspaceService({
  appConfig,
  rbacManifest,
  workspacesRepository,
  workspaceMembershipsRepository,
  workspaceSettingsRepository,
  workspaceInvitesRepository,
  userSettingsRepository,
  userAvatarService
});

const context = await workspaceService.resolveRequestContext({
  user: req.user,
  request: req,
  workspacePolicy: "required"
});
```

## How `jskit-value-app` uses it and why

Real usage:

- `apps/jskit-value-app/server/runtime/services.js`
- `apps/jskit-value-app/tests/workspaceService.test.js`
- `apps/jskit-value-app/tests/workspaceAdminService.test.js`
- `apps/jskit-value-app/tests/workspaceInviteEmailService.test.js`

Why:

- centralizes complex workspace selection and access logic
- keeps admin/member/invite flows consistent across routes
- separates DB operations (repositories) from workspace domain behavior

## Non-goals

- no direct SQL statements
- no Fastify route definitions
- no frontend state/store management
