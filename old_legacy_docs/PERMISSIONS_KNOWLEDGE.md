# Workspace Permission Model Deep-Dive (Context Dump)

This document is a comprehensive dump of what I understood from analyzing workspace-domain permissions in this repo, centered on:

- `packages/workspace/workspace-service-core`
- `packages/workspace/workspace-fastify-routes`
- related action contributors and enforcement infrastructure

It is written from already-collected context and references concrete files + line numbers.

## Table of Contents

- Part I — Workspace Core
- Scope + Primary Components
- 1. How permissions are resolved from role manifest and surface
- 2. All enforcement layers (route-level vs action-level vs service-level)
- 3. Deny-list or context-sensitive policy behavior
- 4. Detailed route/action mapping and mismatches
- 5. Notable security risks and inconsistencies
- 6. Crucial contextual details worth keeping in head
- 7. Practical hardening ideas (from this analysis)
- 8. Short “mental model” summary
- 9. Additional Implementation Detail (from adjacent AGENT docs)
- 10. Realtime permission enforcement and surface policy (Socket.IO)
- 11. README-declared intent and semantics (workspace-service-core, auth policy, RBAC)
- 12. Realtime topic permission matrix (source-of-truth rules)
- 13. Realtime server runtime enforcement paths (shared runtime code)
- 1. Core model: where permissions come from
- 2. Bootstrap and lifecycle by surface
- 3. Router guard architecture
- 4. Route-level permission mapping
- 5. Shell-level gating and navigation filtering
- 6. View-level permission gating patterns
- 7. Realtime permission gating and its limits
- 8. Handling missing permissions: practical outcomes
- 9. Module-driven composition details that affect permissions
- 10. Client-only assumptions and server enforcement requirements
- 11. Notable implementation nuances / possible footguns
- 12. Condensed permission matrix (high-level)
- 13. End-to-end control flow summary
- 14. Practical security posture interpretation
- 15. Backend Enforcement Context (Relevant To Frontend Gating)
- 16. Cross-Layer Alignment Summary (Frontend vs Backend)
- 17. Console Role Catalog Map (Practical UI Effect)
- 18. Additional Permission-Affecting Behaviors
- 19. Practical Implications for Frontend Changes
- 20. RBAC Manifest: Role -> Permission Map (Source of UI Permission Strings)
- 21. Backend Workspace Admin Routes Mirror UI Gating
- 22. App Runtime Policy + Bootstrap Schema: Feature Flags Used by Frontend
- 23. Assistant Server Actions Enforce Required Permission
- 24. Client Chat Runtime Uses Workspace Permission
- 25. Realtime Server SocketIO Enforces Topic Permissions
- 26. Updated Frontend/Backend Alignment Summary
- 27. Workspace + Console Stores: Permission Normalization and Wildcards
- 28. App/Admin Route Guard Pipeline (Workspace Permissions)
- 29. Console Route Guard Pipeline (Console Permissions)
- 30. Route Definitions That Enforce Permissions
- 31. Navigation Gating in Shells (UI Visibility)
- 32. Module Registry + Filesystem Contributions Drive Guard Policies and Nav Rules
- 33. Workspace Admin Views: Permission-Driven UI + Handling Missing Access
- 34. Console Views: Permission Flags and Read-Only UI
- 35. Social View Permission Handling
- 36. Realtime Client Gating + Topic Permission Rules
- 37. Router Composition: Where Guards and Permissions Are Wired In
- 38. Updated Client-Only Assumptions (after deeper read)
- 39. Server Surface Access Policy (App vs Admin)
- 40. Fastify Auth Policy Resolves Permissions for Each Request
- 41. Workspace Permission Resolution (Server) Uses RBAC Manifest
- 42. Console Role Catalog: Source of Console Permissions
- 43. Console Service Builds Console Bootstrap + Enforces Permissions
- 44. Console Action Contributors Enforce Permissions Server-Side
- 45. Workspace Server Actions Enforce the Same Permissions as UI
- 46. Updated Client-Only Assumptions (Server Truth)
- Part II — Domain and Cross-Domain Addendum
- A. Core Enforcement Pipeline (Shared)
- B. RBAC Manifest Snapshot (Relevant Permissions)
- C. Billing Domain (Routes → Actions → Policy → Service)
- D. Social Domain (Routes → Actions → Service)
- E. Chat Domain (Routes → Actions → Service)
- F. Permission Presence vs Absence Matrix (Route Metadata)
- G. Notable Risks / Weak Spots (Based on Source Evidence)
- H. Concrete Permission Enforcement Mapping (By Domain)
- I. Additional Observations (Cross-Cutting)
- J. Summary (Most Important Takeaways)
- K. If You Want More Precision Next



## Part I — Workspace Core

## Scope + Primary Components

### Workspace domain files

- `packages/workspace/workspace-fastify-routes/src/shared/routes/admin.route.js`
- `packages/workspace/workspace-fastify-routes/src/shared/routes/selfService.route.js`
- `packages/workspace/workspace-fastify-routes/src/shared/routes/bootstrap.route.js`
- `packages/workspace/workspace-fastify-routes/src/shared/controller.js`
- `packages/workspace/workspace-service-core/src/shared/actions/workspace.contributor.js`
- `packages/workspace/workspace-service-core/src/shared/services/workspace.service.js`
- `packages/workspace/workspace-service-core/src/shared/services/admin.service.js`
- `packages/workspace/workspace-service-core/src/shared/lookups/workspaceRequestContext.js`
- `packages/workspace/workspace-service-core/src/shared/mappers/workspaceAdminMappers.js`
- `packages/workspace/workspace-service-core/src/shared/policies/workspaceSettingsPatch.js`
- `packages/workspace/workspace-console-core/src/shared/workspaceSettingsPatch.js`

### Shared enforcement/runtime files

- `apps/jskit-value-app/server/fastify/registerApiRoutes.js`
- `apps/jskit-value-app/server/fastify/auth.plugin.js`
- `packages/auth/fastify-auth-policy/src/shared/plugin.js`
- `packages/auth/fastify-auth-policy/src/shared/routeMeta.js`
- `apps/jskit-value-app/server/runtime/actions/buildExecutionContext.js`
- `apps/jskit-value-app/server/runtime/actions/createActionRegistry.js`
- `packages/runtime/action-runtime-core/src/shared/policies.js`
- `packages/runtime/action-runtime-core/src/shared/pipeline.js`
- `packages/runtime/action-runtime-core/src/shared/contracts.js`

### RBAC source-of-truth files

- `apps/jskit-value-app/shared/rbac.manifest.json`
- `apps/jskit-value-app/server.js`
- `packages/auth/rbac-core/src/shared/index.js`

## 1. How permissions are resolved from role manifest and surface

## 1.1 Manifest load + normalization at startup

- Manifest is loaded once at server startup:
  - `apps/jskit-value-app/server.js:75`
- It is passed into runtime/service composition:
  - `apps/jskit-value-app/server.js:143`
- It is decorated on Fastify app:
  - `apps/jskit-value-app/server.js:580`

RBAC normalization behavior:

- Owner role is required/non-assignable and must include `*`:
  - `packages/auth/rbac-core/src/shared/index.js:33`
  - `packages/auth/rbac-core/src/shared/index.js:43`
- `collaborationEnabled` is derived from assignable roles + valid default invite role:
  - `packages/auth/rbac-core/src/shared/index.js:77`
  - `packages/auth/rbac-core/src/shared/index.js:83`
- Role permissions resolve with owner shortcut:
  - `packages/auth/rbac-core/src/shared/index.js:112`
  - `packages/auth/rbac-core/src/shared/index.js:116`

Only one explicit startup manifest-permission validation is present:

- AI required permission is checked against manifest:
  - `apps/jskit-value-app/server.js:175`
  - `apps/jskit-value-app/server.js:178`
- No equivalent global startup validation for workspace route/action permissions.

## 1.2 Request surface resolution and context assembly

Surface resolution precedence in workspace context lookup:

1. explicit preferred surface arg
2. `x-surface-id` header
3. pathname-derived surface

Reference:

- `packages/workspace/workspace-service-core/src/shared/lookups/workspaceRequestContext.js:34`
- `packages/workspace/workspace-service-core/src/shared/lookups/workspaceRequestContext.js:42`
- `packages/workspace/workspace-service-core/src/shared/lookups/workspaceRequestContext.js:47`
- `packages/workspace/workspace-service-core/src/shared/lookups/workspaceRequestContext.js:52`

Workspace selection hint precedence:

1. `x-workspace-slug` header
2. query `workspaceSlug`
3. params `workspaceSlug`

- `packages/workspace/workspace-service-core/src/shared/lookups/workspaceRequestContext.js:56`

## 1.3 Workspace service permission resolution

`workspaceService.resolvePermissions(roleId)` does:

- normalize role id
- if owner -> `["*"]`
- else `resolveRolePermissions(rbacManifest, normalizedRoleId)`

- `packages/workspace/workspace-service-core/src/shared/services/workspace.service.js:489`
- `packages/workspace/workspace-service-core/src/shared/services/workspace.service.js:496`
- `packages/workspace/workspace-service-core/src/shared/services/workspace.service.js:500`

## 1.4 Surface-specific access decision

Default resolver maps surface to access function:

- `app` -> `canAccessAppWorkspace`
- `admin` -> `canAccessAdminWorkspace`
- anything else -> deny (`surface_not_supported`)

- `packages/workspace/workspace-service-core/src/shared/services/workspace.service.js:171`
- `packages/workspace/workspace-service-core/src/shared/services/workspace.service.js:174`
- `packages/workspace/workspace-service-core/src/shared/services/workspace.service.js:177`

`canAccessAppWorkspace` requires:

- authenticated user object
- active membership (role + status)
- not on app deny-list (`denyUserIds`, `denyEmails`)
- then permissions resolved from membership role

- `packages/workspace/workspace-service-core/src/shared/services/workspace.service.js:79`
- `packages/workspace/workspace-service-core/src/shared/services/workspace.service.js:89`
- `packages/workspace/workspace-service-core/src/shared/services/workspace.service.js:100`
- `packages/workspace/workspace-service-core/src/shared/services/workspace.service.js:104`
- `packages/workspace/workspace-service-core/src/shared/services/workspace.service.js:112`
- `packages/workspace/workspace-service-core/src/shared/services/workspace.service.js:120`

`canAccessAdminWorkspace` requires:

- active membership
- permissions resolved from role
- no app deny-list checks

- `packages/workspace/workspace-service-core/src/shared/services/workspace.service.js:136`
- `packages/workspace/workspace-service-core/src/shared/services/workspace.service.js:140`
- `packages/workspace/workspace-service-core/src/shared/services/workspace.service.js:148`

## 1.5 Final request context payload

`resolveRequestContext` returns:

- `workspace`
- `membership`
- `permissions`
- plus `workspaces`, `userSettings`

It throws:

- `403` if explicitly requested slug is rejected (`requestedSlugRejected`)
- `409` if workspace policy required but no selected workspace

- `packages/workspace/workspace-service-core/src/shared/services/workspace.service.js:766`
- `packages/workspace/workspace-service-core/src/shared/services/workspace.service.js:789`
- `packages/workspace/workspace-service-core/src/shared/services/workspace.service.js:793`
- `packages/workspace/workspace-service-core/src/shared/services/workspace.service.js:812`

## 2. All enforcement layers (route-level vs action-level vs service-level)

## 2.1 Route metadata declaration layer

Workspace admin routes declare:

- `auth: "required"`
- `workspacePolicy: "required"`
- `workspaceSurface: "admin"`
- `permission: "<permission-id>"`

Reference examples:

- `packages/workspace/workspace-fastify-routes/src/shared/routes/admin.route.js:8`
- `packages/workspace/workspace-fastify-routes/src/shared/routes/admin.route.js:9`
- `packages/workspace/workspace-fastify-routes/src/shared/routes/admin.route.js:10`
- `packages/workspace/workspace-fastify-routes/src/shared/routes/admin.route.js:11`

Self-service workspace routes only declare `auth: "required"` and no permission string:

- `packages/workspace/workspace-fastify-routes/src/shared/routes/selfService.route.js:8`
- `packages/workspace/workspace-fastify-routes/src/shared/routes/selfService.route.js:21`
- `packages/workspace/workspace-fastify-routes/src/shared/routes/selfService.route.js:38`
- `packages/workspace/workspace-fastify-routes/src/shared/routes/selfService.route.js:51`

Bootstrap route is public:

- `packages/workspace/workspace-fastify-routes/src/shared/routes/bootstrap.route.js:8`

## 2.2 Route policy merge and Fastify preHandler enforcement

Route metadata is merged into Fastify route config:

- `apps/jskit-value-app/server/fastify/registerApiRoutes.js:19`
- `apps/jskit-value-app/server/fastify/registerApiRoutes.js:20`
- `apps/jskit-value-app/server/fastify/registerApiRoutes.js:23`

`fastify-auth-policy` preHandler does:

1. resolve route auth meta from config
2. authenticate actor
3. resolve context if workspace policy required/optional or permission exists
4. set `request.workspace`, `request.membership`, `request.permissions`
5. enforce route `permission` via injected `hasPermission`

- `packages/auth/fastify-auth-policy/src/shared/plugin.js:123`
- `packages/auth/fastify-auth-policy/src/shared/plugin.js:129`
- `packages/auth/fastify-auth-policy/src/shared/plugin.js:207`
- `packages/auth/fastify-auth-policy/src/shared/plugin.js:215`
- `packages/auth/fastify-auth-policy/src/shared/plugin.js:220`
- `packages/auth/fastify-auth-policy/src/shared/plugin.js:231`

In this app, injected permission checker is `rbac-core.hasPermission`:

- `apps/jskit-value-app/server/fastify/auth.plugin.js:5`
- `apps/jskit-value-app/server/fastify/auth.plugin.js:113`

And workspace context is resolved by `workspaceService.resolveRequestContext` unless console surface is requested:

- `apps/jskit-value-app/server/fastify/auth.plugin.js:80`
- `apps/jskit-value-app/server/fastify/auth.plugin.js:85`
- `apps/jskit-value-app/server/fastify/auth.plugin.js:106`

## 2.3 Controller -> Action runtime enforcement

Workspace controllers call action executor with `context.channel = "api"`:

- `packages/workspace/workspace-fastify-routes/src/shared/controller.js:51`
- `packages/workspace/workspace-fastify-routes/src/shared/controller.js:57`

Action execution context is built from request:

- surface from explicit/request/header/pathname
- workspace/membership/permissions pulled from request by default

- `apps/jskit-value-app/server/runtime/actions/buildExecutionContext.js:58`
- `apps/jskit-value-app/server/runtime/actions/buildExecutionContext.js:70`
- `apps/jskit-value-app/server/runtime/actions/buildExecutionContext.js:78`
- `apps/jskit-value-app/server/runtime/actions/buildExecutionContext.js:80`

Action runtime pipeline enforces:

1. allowed channel
2. allowed surface
3. visibility gate
4. action permission policy

- `packages/runtime/action-runtime-core/src/shared/pipeline.js:104`
- `packages/runtime/action-runtime-core/src/shared/pipeline.js:105`
- `packages/runtime/action-runtime-core/src/shared/pipeline.js:106`
- `packages/runtime/action-runtime-core/src/shared/pipeline.js:109`
- `packages/runtime/action-runtime-core/src/shared/pipeline.js:115`

Permission policy types:

- function policy `(context, input) => boolean/object`
- array policy `[permissionA, ...]` requiring all entries

- `packages/runtime/action-runtime-core/src/shared/policies.js:27`
- `packages/runtime/action-runtime-core/src/shared/policies.js:30`
- `packages/runtime/action-runtime-core/src/shared/policies.js:55`
- `packages/runtime/action-runtime-core/src/shared/policies.js:58`

Default permission check semantics for arrays:

- wildcard `*` or exact match

- `packages/runtime/action-runtime-core/src/shared/policies.js:11`
- `packages/runtime/action-runtime-core/src/shared/policies.js:21`

## 2.4 Workspace action contributor permission declarations

Workspace actions and key permissions:

- `workspace.bootstrap.read` -> `allowPublic` (no auth requirement)
  - `workspace.contributor.js:90`
  - `workspace.contributor.js:97`
- `workspace.workspaces.list` -> `requireAuthenticated`
  - `workspace.contributor.js:111`
  - `workspace.contributor.js:118`
- `workspace.select` -> `requireAuthenticated`
  - `workspace.contributor.js:133`
  - `workspace.contributor.js:140`
- `workspace.invitations.pending.list` -> `requireAuthenticated`
  - `workspace.contributor.js:156`
  - `workspace.contributor.js:163`
- `workspace.roles.list` -> `["workspace.roles.view"]`
  - `workspace.contributor.js:176`
  - `workspace.contributor.js:183`
- `workspace.settings.read` -> function (`settings.view` OR `settings.update`)
  - `workspace.contributor.js:196`
  - `workspace.contributor.js:203`
  - `workspace.contributor.js:29`
- `workspace.settings.update` -> `["workspace.settings.update"]`
  - `workspace.contributor.js:216`
  - `workspace.contributor.js:223`
- `workspace.members.list` -> `["workspace.members.view"]`
  - `workspace.contributor.js:238`
  - `workspace.contributor.js:245`
- `workspace.member.role.update` -> `["workspace.members.manage"]`
  - `workspace.contributor.js:256`
  - `workspace.contributor.js:263`
- `workspace.invites.list` -> `["workspace.members.view"]`
  - `workspace.contributor.js:278`
  - `workspace.contributor.js:285`
- `workspace.invite.create` -> `["workspace.members.invite"]`
  - `workspace.contributor.js:296`
  - `workspace.contributor.js:303`
- `workspace.invite.revoke` -> `["workspace.invites.revoke"]`
  - `workspace.contributor.js:322`
  - `workspace.contributor.js:329`
- `workspace.invite.redeem` -> `requireAuthenticated`
  - `workspace.contributor.js:344`
  - `workspace.contributor.js:351`
- AI transcript actions (conditionally added) with read/export permissions
  - `workspace.contributor.js:368`
  - `workspace.contributor.js:383`
  - `workspace.contributor.js:401`
  - `workspace.contributor.js:425`

## 2.5 Service/business policy layer

`workspace.service.js` enforces workspace access and selection logic, not per-operation permission IDs.

`admin.service.js` enforces business constraints:

- valid workspace exists
- assignable roles only
- cannot mutate owner role
- invite availability gating
- invite token/email matching

- `packages/workspace/workspace-service-core/src/shared/services/admin.service.js:53`
- `packages/workspace/workspace-service-core/src/shared/services/admin.service.js:67`
- `packages/workspace/workspace-service-core/src/shared/services/admin.service.js:79`
- `packages/workspace/workspace-service-core/src/shared/services/admin.service.js:276`
- `packages/workspace/workspace-service-core/src/shared/services/admin.service.js:390`
- `packages/workspace/workspace-service-core/src/shared/services/admin.service.js:620`

Important: admin service methods do not take an actor permissions object and do not independently RBAC-check route/action permission strings.

## 3. Deny-list or context-sensitive policy behavior

## 3.1 Deny-list storage model and normalization

Deny-list fields live under workspace settings:

- `features.surfaceAccess.app.denyUserIds`
- `features.surfaceAccess.app.denyEmails`

Read/normalize path:

- `workspace.service.js:66`
- `workspace.service.js:69`
- `workspace.service.js:71`
- `workspace.service.js:74`
- `workspace.service.js:75`

Patch parsing and validation:

- `packages/workspace/workspace-console-core/src/shared/workspaceSettingsPatch.js:208`
- `packages/workspace/workspace-console-core/src/shared/workspaceSettingsPatch.js:220`
- `packages/workspace/workspace-console-core/src/shared/workspaceSettingsPatch.js:223`

Applied into settings update patch:

- `admin.service.js:166`
- `admin.service.js:178`
- `admin.service.js:180`
- `admin.service.js:182`

## 3.2 Deny-list enforcement behavior

Deny-lists are enforced only on app surface access:

- user id deny -> `reason: "user_denied"`
  - `workspace.service.js:104`
- email deny -> `reason: "email_denied"`
  - `workspace.service.js:112`

Admin surface does not apply deny-list checks:

- `workspace.service.js:136`
- `workspace.service.js:148`

## 3.3 Deny-list visibility in settings responses

Settings response includes `appDenyEmails` and `appDenyUserIds` only when `includeAppSurfaceDenyLists === true`:

- `workspaceAdminMappers.js:45`
- `workspaceAdminMappers.js:55`

Workspace action contributor controls this by permission:

- `workspace.settings.read` passes `includeAppSurfaceDenyLists` iff caller has `workspace.settings.update`
  - `workspace.contributor.js:210`
  - `workspace.contributor.js:211`

Effect:

- settings viewers can read core settings but not deny-lists
- settings updaters can read deny-lists

## 3.4 Additional context-sensitive behavior

- Requested workspace slug mismatch/inaccessibility is strict `403`:
  - `workspace.service.js:703`
  - `workspace.service.js:789`
- Workspace required policy with no selected workspace returns `409`:
  - `workspace.service.js:793`
- Invite availability depends on both app feature + manifest collaboration + workspace setting:
  - `admin.service.js:390`
  - `admin.service.js:392`
  - `rbac-core/index.js:83`

## 4. Detailed route/action mapping and mismatches

## 4.1 Bootstrap + self-service

- `GET /api/bootstrap`
  - route auth: public
  - route permission: none
  - controller calls `auth.session.read` then `workspace.bootstrap.read`
  - action permission: `allowPublic`
  - refs:
    - `bootstrap.route.js:8`
    - `workspace controller.js:123`
    - `workspace controller.js:126`
    - `workspace controller.js:148`
    - `workspace.contributor.js:97`

- `GET /api/workspaces`
  - route auth: required
  - no route `permission` field
  - action: `workspace.workspaces.list`
  - action permission: `requireAuthenticated`
  - refs:
    - `selfService.route.js:8`
    - `workspace controller.js:170`
    - `workspace.contributor.js:118`

- `POST /api/workspaces/select`
  - route auth: required
  - no route `permission`
  - action: `workspace.select`
  - action permission: `requireAuthenticated`
  - refs:
    - `selfService.route.js:21`
    - `workspace controller.js:178`
    - `workspace.contributor.js:140`

- `GET /api/workspace/invitations/pending`
  - route auth: required
  - no route `permission`
  - action: `workspace.invitations.pending.list`
  - action permission: `requireAuthenticated`
  - refs:
    - `selfService.route.js:38`
    - `workspace controller.js:338`
    - `workspace.contributor.js:163`

- `POST /api/workspace/invitations/redeem`
  - route auth: required
  - no route `permission`
  - action: `workspace.invite.redeem`
  - action permission: `requireAuthenticated`
  - refs:
    - `selfService.route.js:51`
    - `workspace controller.js:346`
    - `workspace.contributor.js:351`

## 4.2 Admin workspace routes

- `GET /api/admin/workspace/settings`
  - route permission: `workspace.settings.view`
  - action: `workspace.settings.read`
  - action permission: `workspace.settings.view OR workspace.settings.update`
  - mismatch exists (route stricter than action for update-only users)
  - refs:
    - `admin.route.js:11`
    - `workspace controller.js:191`
    - `workspace.contributor.js:196`
    - `workspace.contributor.js:203`
    - `workspace.contributor.js:29`

- `PATCH /api/admin/workspace/settings`
  - route permission: `workspace.settings.update`
  - action permission: `["workspace.settings.update"]`
  - refs:
    - `admin.route.js:27`
    - `workspace controller.js:199`
    - `workspace.contributor.js:223`

- `GET /api/admin/workspace/roles`
  - route permission: `workspace.roles.view`
  - action permission: `["workspace.roles.view"]`
  - refs:
    - `admin.route.js:47`
    - `workspace controller.js:233`
    - `workspace.contributor.js:183`

- `GET /api/admin/workspace/ai/transcripts`
  - route permission: `workspace.ai.transcripts.read`
  - action permission: `["workspace.ai.transcripts.read"]`
  - refs:
    - `admin.route.js:63`
    - `workspace controller.js:377`
    - `workspace.contributor.js:383`

- `GET /api/admin/workspace/ai/transcripts/:conversationId/messages`
  - route permission: `workspace.ai.transcripts.read`
  - action permission: `["workspace.ai.transcripts.read"]`
  - refs:
    - `admin.route.js:83`
    - `workspace controller.js:390`
    - `workspace.contributor.js:401`

- `GET /api/admin/workspace/ai/transcripts/:conversationId/export`
  - route permission: `workspace.ai.transcripts.export`
  - action permission: `["workspace.ai.transcripts.export"]`
  - refs:
    - `admin.route.js:104`
    - `workspace controller.js:407`
    - `workspace.contributor.js:425`

- `GET /api/admin/workspace/members`
  - route permission: `workspace.members.view`
  - action permission: `["workspace.members.view"]`
  - refs:
    - `admin.route.js:125`
    - `workspace controller.js:241`
    - `workspace.contributor.js:245`

- `PATCH /api/admin/workspace/members/:memberUserId/role`
  - route permission: `workspace.members.manage`
  - action permission: `["workspace.members.manage"]`
  - refs:
    - `admin.route.js:141`
    - `workspace controller.js:249`
    - `workspace.contributor.js:263`

- `GET /api/admin/workspace/invites`
  - route permission: `workspace.members.view`
  - action permission: `["workspace.members.view"]`
  - refs:
    - `admin.route.js:162`
    - `workspace controller.js:278`
    - `workspace.contributor.js:285`

- `POST /api/admin/workspace/invites`
  - route permission: `workspace.members.invite`
  - action permission: `["workspace.members.invite"]`
  - refs:
    - `admin.route.js:178`
    - `workspace controller.js:286`
    - `workspace.contributor.js:303`

- `DELETE /api/admin/workspace/invites/:inviteId`
  - route permission: `workspace.invites.revoke`
  - action permission: `["workspace.invites.revoke"]`
  - refs:
    - `admin.route.js:202`
    - `workspace controller.js:312`
    - `workspace.contributor.js:329`

## 5. Notable security risks and inconsistencies

## 5.1 Route-vs-action permission mismatch for settings read

Issue:

- Route requires `workspace.settings.view`
- Action allows `workspace.settings.update` too

If action called from non-HTTP/internal channels, behavior differs from route path.

Refs:

- `admin.route.js:11`
- `workspace.contributor.js:29`
- `workspace.contributor.js:203`

## 5.2 Service layer is authz-agnostic API surface

`workspaceAdminService` methods do not accept/enforce caller permission sets; they assume caller already authorized by route/action layer.

Direct internal service misuse can bypass RBAC if caller can pass workspace context.

- `admin.service.js:139`
- `admin.service.js:237`
- `admin.service.js:387`
- `admin.service.js:513`

## 5.3 Header-driven surface can affect access logic

Surface may come from `x-surface-id` when route does not pin `workspaceSurface`, notably self-service paths and some action execution context builds.

Because app/admin access functions differ (deny-list only on app), header influence changes policy path.

- `workspaceRequestContext.js:47`
- `workspace.service.js:924`
- `buildExecutionContext.js:24`
- `selfService.route.js:6`

## 5.4 No comprehensive startup validation that workspace permission IDs exist in manifest

Only AI-required permission is validated on startup.

Typos in workspace route/action permission strings become runtime denials (fail-closed), but no early alert for policy drift.

- `server.js:175`
- `server.js:178`
- `workspace.contributor.js:223` (example action permission field)
- `admin.route.js:11` (example route permission field)

## 5.5 Deny-list applies only to app surface

Intentional/possible, but security model implication:

- denied users/emails can still be admin-surface-accessible if they have active membership and permissions.

- `workspace.service.js:104`
- `workspace.service.js:112`
- `workspace.service.js:136`

## 5.6 Unknown role IDs can still pass membership gate with empty permissions

Access decision can return `allowed: true` with `permissions: []` for active membership whose role is not in manifest (non-owner). This may allow auth-only flows like workspace listing/selection while failing permission-gated operations.

- `workspace.service.js:124`
- `workspace.service.js:148`
- `rbac-core/index.js:120`
- `rbac-core/index.js:122`

## 5.7 Multiple `hasPermission` implementations across layers

Semantics are mostly aligned (`*` or exact), but duplicated helpers exist in:

- workspace contributor
- action runtime
- rbac-core

Risk: future drift in edge semantics.

- `workspace.contributor.js:10`
- `action-runtime/policies.js:11`
- `rbac-core/index.js:127`

## 6. Crucial contextual details worth keeping in head

## 6.1 Route auth policy defaults and derived behavior

`fastify-auth-policy` defaults to:

- `authPolicy: public`
- `workspacePolicy: none`
- empty permission

- `routeMeta.js:13`
- `routeMeta.js:15`
- `routeMeta.js:17`

This means missing route metadata can silently become more permissive unless route author sets explicit constraints.

## 6.2 Action runtime also enforces allowed surfaces/channels

Even if route-level auth passes, action execution can still fail if action surfaces/channels don't match context.

- `action-runtime/policies.js:80`
- `action-runtime/policies.js:95`
- `action-runtime/contracts.js:16`
- `action-runtime/contracts.js:17`

## 6.3 Workspace action set is constrained to surfaces `app`/`admin` (not `console`)

Workspace contributor actions define surfaces `["app","admin"]` or `["admin"]`.

Ref examples:

- `workspace.contributor.js:94`
- `workspace.contributor.js:180`

So if execution context surface resolves to `console`, these actions are blocked by action runtime surface gate.

## 6.4 Invite controls are layered

- Global app feature `workspaceInvites`
- Manifest-derived `collaborationEnabled`
- Workspace setting `invitesEnabled`

All must align for invite creation.

- `admin.service.js:390`
- `admin.service.js:392`
- `workspaceMappers.js:43`
- `workspaceAdminMappers.js:41`

## 7. Practical hardening ideas (from this analysis)

1. Add startup validation for all declared workspace route/action permissions against RBAC manifest, similar to AI required-permission startup check.
2. Eliminate route/action mismatch for settings read by making both layers use the same rule (`view OR update` or strictly `view`) and documenting it.
3. Consider pinning `workspaceSurface` on self-service workspace routes to reduce header-driven policy variance.
4. Add optional defensive authz assertions inside `workspaceAdminService` (or a thin policy wrapper) for critical mutation methods when called internally.
5. Centralize permission helper usage to `@jskit-ai/rbac-core/hasPermission` where possible to reduce semantic drift.
6. Decide whether deny-lists should apply to admin surface; if intentional not to, explicitly document that in service README + security docs.
7. Add explicit observability counters/log dimensions for `reason` values from workspace access decisions (`user_denied`, `email_denied`, `membership_required`, `surface_not_supported`) to detect policy misconfigurations.

## 8. Short “mental model” summary

- RBAC manifest defines permission vocabulary and role mappings.
- Fastify preHandler enforces route policy using resolved workspace context permissions.
- Controllers delegate to action runtime, which enforces a second authorization gate (action permission + allowed surface/channel).
- Workspace service computes effective permissions by role and applies surface-specific access constraints.
- Admin service mostly enforces business invariants and assumes higher layers already authorized the call.
- App-surface deny-lists are real and enforced, but are intentionally hidden from read-only settings viewers and currently do not apply to admin surface access.

## 9. Additional Implementation Detail (from adjacent AGENT docs)

This section consolidates extra workspace-domain-adjacent observations from the other `AGENT_*.md` files read, while staying in this document’s domain (workspace permission model, enforcement layers, deny-list behavior, and cross-cutting permission infrastructure). It does not introduce new file reads; it only integrates previously captured context.

### 9.1 Action runtime requires permission policy for every action

The action runtime definition normalization requires a non-empty `permission` policy:

- A function is allowed (custom logic), or
- An array of permissions with at least one entry.

This is enforced by `normalizeActionDefinition` and `normalizePermissionPolicy` in `action-runtime-core`.

- `packages/runtime/action-runtime-core/src/shared/contracts.js:124`
- `packages/runtime/action-runtime-core/src/shared/contracts.js:129`
- `packages/runtime/action-runtime-core/src/shared/contracts.js:275`

Implication: workspace actions must always specify a permission policy (even for public access), which reinforces the action-level enforcement layer.

### 9.2 Action runtime permission enforcement order

Action runtime enforces surface/channel/visibility before permission policy. This means the request must match action `surfaces` and `channels` even if permissions are granted.

- `packages/runtime/action-runtime-core/src/shared/pipeline.js:104`
- `packages/runtime/action-runtime-core/src/shared/policies.js:80`
- `packages/runtime/action-runtime-core/src/shared/policies.js:95`
- `packages/runtime/action-runtime-core/src/shared/policies.js:110`

This matters in the workspace domain because workspace actions only allow `app`/`admin` surfaces; any `console` surface execution will be blocked at action runtime even if `request.permissions` were set.

### 9.3 Execution context permission precedence in action runtime

`buildExecutionContext` prefers an explicit `permissions` override from the caller over `request.permissions`. In other words, internal action execution can supply a custom permission set.

- `apps/jskit-value-app/server/runtime/actions/buildExecutionContext.js:70`
- `apps/jskit-value-app/server/runtime/actions/buildExecutionContext.js:72`

This is powerful but requires discipline: internal calls must not supply an overly broad permission set without justification.

### 9.4 Workspace settings and response contracts expose permission state

The workspace REST schemas expose:

- `permissions: string[]` in bootstrap response
- `permissions: string[]` in workspace selection response
- `roleCatalog` in admin settings responses

- `packages/workspace/workspace-fastify-routes/src/shared/schemas/bootstrap.schema.js:108`
- `packages/workspace/workspace-fastify-routes/src/shared/schemas/selfService.schema.js:59`
- `packages/workspace/workspace-fastify-routes/src/shared/schemas/shared.schema.js:102`

This is consistent with the permission model: server resolves permissions, client uses them for UI gating only (not security).

### 9.5 Manifest-driven permission enforcement in other domains influences workspace model expectations

`billing`, `chat`, and `social` subsystems use a mix of route-level permissions and service-level checks. The workspace permission model should be treated similarly: route metadata is not the only enforcement layer.

Examples (from the other AGENT files, kept here as cross-cutting context):

- Chat service conditionally enforces `chat.read/write` only if the permission is present in the manifest (similar in spirit to optional permissions for workspace-related features).
  - `packages/chat/chat-core/src/shared/service.js:742`
- Billing routes omit `permission` metadata and rely on action/service checks, showing that permission enforcement can be layered beyond routes.
  - `apps/jskit-value-app/tests/billingRoutesPolicy.test.js:69`

This supports the conclusion that workspace permissions must be validated at multiple layers, not just routes.

### 9.6 Auth policy structured deny reasons (observability relevance)

Auth policy plugin emits structured denial reasons, which can be leveraged to detect permission-policy misconfigurations or attack attempts.

- `packages/auth/fastify-auth-policy/src/shared/errors.js:1`

This complements the workspace access `reason` codes and supports the hardening suggestion to add metrics for denial reasons.

## 10. Realtime permission enforcement and surface policy (Socket.IO)

Workspace permissions are enforced not only for HTTP routes/actions, but also in realtime subscription and fanout. The realtime server runtime is shared, and app-specific policy is injected via a small adapter.

### 10.1 App realtime adapter wires policy + workspace context into shared runtime

The app-level `registerSocketIoRealtime` passes runtime dependencies and policy callbacks into the shared `registerRealtimeServerSocketio` entrypoint. This is the boundary where:

- `authService` and `workspaceService` are injected for auth + workspace context resolution
- realtime policy callbacks are injected (`isSupportedTopic`, `getTopicScope`, `isTopicAllowedForSurface`, `hasTopicPermission`)
- subscribe-context shaping functions are injected (`buildSubscribeContextRequest`, `normalizeConnectionSurface`, `normalizeWorkspaceSlug`)

- `apps/jskit-value-app/server/realtime/registerSocketIoRealtime.js:37`
- `apps/jskit-value-app/server/realtime/registerSocketIoRealtime.js:60`
- `apps/jskit-value-app/server/realtime/registerSocketIoRealtime.js:73`
- `apps/jskit-value-app/server/realtime/registerSocketIoRealtime.js:99`

### 10.2 Topic permission rules come from realtime topic catalog, not workspace service

`composeRealtimePolicy` builds a topic catalog from enabled runtime modules and delegates topic rule behavior to the realtime-contracts catalog:

- topics are collected from `composeServerRuntimeArtifacts(...)` and normalized
- `REALTIME_TOPIC_REGISTRY` rules are used to build the catalog
- `isSupportedTopic`, `isTopicAllowedForSurface`, and `hasTopicPermission` delegate to catalog helpers

This means topic permission rules (what permission string controls which topic) are defined in the realtime-contracts topic registry, not inside workspace service.

- `apps/jskit-value-app/server/framework/composeRealtime.js:14`
- `apps/jskit-value-app/server/framework/composeRealtime.js:26`
- `apps/jskit-value-app/server/framework/composeRealtime.js:68`
- `apps/jskit-value-app/shared/topicRegistry.js:1`

### 10.3 Realtime subscribe context shaping mirrors workspace surface rules

Realtime subscriptions use `buildSubscribeContextRequest` to emulate a request that workspace-service can understand:

- `normalizeConnectionSurface` defaults to `"app"` when empty, and rejects unknown surfaces (`""`)
- `normalizeWorkspaceSlug` lowercases and enforces slug pattern; invalid slugs become empty strings
- `buildSubscribeContextRequest` injects `x-surface-id` + `x-workspace-slug`, adds matching `params`/`query`, and crafts a workspace URL using surface prefix (`/admin/w/...` or `/console/w/...`)

- `apps/jskit-value-app/server/fastify/realtime/subscribeContext.js:3`
- `apps/jskit-value-app/server/fastify/realtime/subscribeContext.js:16`
- `apps/jskit-value-app/server/fastify/realtime/subscribeContext.js:29`
- `packages/surface-routing/src/shared/appSurfaces.js:5`

Surface definitions confirm:

- `app` and `admin` require a workspace
- `console` does not require a workspace

- `packages/surface-routing/src/shared/appSurfaces.js:5`

### 10.4 Realtime handshake + subscribe enforcement (tests)

Handshake requires auth:

- Connection without auth cookie is rejected with `unauthorized`

Ref:

- `apps/jskit-value-app/tests/realtimeRoutes.test.js:23`

Unsupported surfaces are rejected without workspace context lookup:

- `surface=future` returns `unsupported_surface`
- `workspaceService` is not called

- `apps/jskit-value-app/tests/realtimeRoutes.test.js:610`

User-scoped topics can skip workspace context entirely:

- Alert topic subscription does not require `workspaceSlug`
- `workspaceService` is not called for user-scoped `alerts`
- Must explicitly subscribe to receive alerts; unsubscribe stops delivery

- `apps/jskit-value-app/tests/realtimeRoutes.test.js:171`
- `apps/jskit-value-app/tests/realtimeRoutes.test.js:224`

Server-side surface override wins over client payload:

- Connection is established with `surface=admin`
- Client sends `surface=app` in subscribe payload
- `workspaceService` still receives `x-surface-id: admin`

- `apps/jskit-value-app/tests/realtimeRoutes.test.js:254`

Topic surface gating happens before workspace resolution:

- App surface cannot subscribe to admin-only `workspace_settings`
- Request fails `forbidden` and does not call `workspaceService`

- `apps/jskit-value-app/tests/realtimeRoutes.test.js:628`

App deny-list applies to realtime subscriptions; admin bypasses it:

- `app` surface denies `workspace_meta` when user is on deny list
- `admin` surface allows `workspace_settings` for same user

- `apps/jskit-value-app/tests/realtimeRoutes.test.js:657`
- `apps/jskit-value-app/tests/realtimeRoutes.test.js:691`

Permission-based topic gating:

- `projects` subscription returns `forbidden` without `projects.read`
- `workspace_meta` subscription succeeds without additional permissions

- `apps/jskit-value-app/tests/realtimeRoutes.test.js:725`
- `apps/jskit-value-app/tests/realtimeRoutes.test.js:757`

### 10.5 Realtime fanout re-checks permissions and evicts stale subscriptions

When permissions are revoked after subscribe:

- The existing subscription is evicted and events are not delivered
- Restoring permissions does not automatically restore delivery (requires resubscribe)

- `apps/jskit-value-app/tests/realtimeRoutes.test.js:350`
- `apps/jskit-value-app/tests/realtimeRoutes.test.js:410`

For workspace-scoped targeted chat events:

- Event delivery is re-checked against permissions per event
- Revocation prevents delivery and evicts subscription

- `apps/jskit-value-app/tests/realtimeRoutes.test.js:430`

Transient auth failures during fanout do not evict:

- A temporary `resolveRequestContext` error skips delivery
- Subsequent events deliver once the dependency recovers

- `apps/jskit-value-app/tests/realtimeRoutes.test.js:525`

### 10.6 Targeted fanout behavior affects perceived permission scope

Targeted chat events:

- Deliver only to explicit target user rooms
- Global DM events deliver even without workspace subscriptions

- `apps/jskit-value-app/tests/realtimeRoutes.test.js:35`

This is not a workspace permission bypass in itself (events are targeted), but it is a separate delivery plane from workspace-topic subscriptions that must be accounted for in any access-control review.

## 11. README-declared intent and semantics (workspace-service-core, auth policy, RBAC)

The package READMEs describe the intended permission model and confirm core concepts used by the code.

### 11.1 Workspace-service-core README confirms key permission concepts

The workspace service README defines:

- The service is the domain layer for workspace context resolution + admin management (not routes/DB)
- Key terms: `tenancy mode`, `workspace context` (workspace + membership + permissions), `surface` (`app`, `admin`, `console`)
- Service exports include `resolveRequestContext` and `resolvePermissions`

- `packages/workspace/workspace-service-core/README.md:3`
- `packages/workspace/workspace-service-core/README.md:17`
- `packages/workspace/workspace-service-core/README.md:161`

### 11.2 Auth policy README describes route metadata and context resolution contract

The auth policy README explicitly describes:

- `authPolicyPlugin` as the shared pre-handler enforcement engine
- `resolveContext` being called when `meta.workspacePolicy` asks for it, returning workspace + membership + permissions
- route metadata block includes `authPolicy`, `workspacePolicy`, `workspaceSurface`, `permission`

- `packages/auth/fastify-auth-policy/README.md:114`
- `packages/auth/fastify-auth-policy/README.md:161`
- `packages/auth/fastify-auth-policy/README.md:296`

### 11.3 RBAC README emphasizes optional permission gating and startup validation

The RBAC README documents:

- `manifestIncludesPermission` for optional enforcement based on manifest contents
- startup validation flow that checks required permissions and lists known permissions
- route-level authorization recommended flow: resolve permissions + enforce via `hasPermission`

- `packages/auth/rbac-core/README.md:373`
- `packages/auth/rbac-core/README.md:417`
- `packages/auth/rbac-core/README.md:431`

## 12. Realtime topic permission matrix (source-of-truth rules)

The realtime permission rules are defined in the `@jskit-ai/realtime-contracts` topic registry. This is the authoritative map of:

- topic scope (workspace vs user)
- allowed subscription surfaces
- required permissions (global or per-surface)

### 12.1 Topic registry and permission requirements

Source: `node_modules/@jskit-ai/realtime-contracts/src/shared/appTopics.js`

Workspace-scoped topics:

- `projects`: surfaces `app|admin`, requires `projects.read`
- `workspace_meta`: surfaces `app`, requires none
- `workspace_settings`: surfaces `admin`, requires any of `workspace.settings.view` or `workspace.settings.update`
- `workspace_members`: surfaces `admin`, requires `workspace.members.view`
- `workspace_invites`: surfaces `admin`, requires `workspace.members.view`
- `workspace_ai_transcripts`: surfaces `app|admin`
  - `app`: no permission required
  - `admin`: requires `workspace.ai.transcripts.read`
- `workspace_billing_limits`: surfaces `app|admin`
  - `app`: no permission required
  - `admin`: requires `workspace.billing.manage`
- `chat`: surfaces `app|admin`, requires `chat.read`
- `typing`: surfaces `app|admin`, requires `chat.read`
- `social_feed`: surfaces `app|admin`, requires `social.read`
- `social_notifications`: surfaces `app|admin`, requires `social.read`

User-scoped topics:

- `alerts`: surfaces `app|admin|console`, requires none
- `settings`: surfaces `app|admin|console`, requires none
- `history`: surfaces `app`, requires `history.read`
- `console_settings`: surfaces `console`, requires none
- `console_members`: surfaces `console`, requires none
- `console_invites`: surfaces `console`, requires none
- `console_billing`: surfaces `console`, requires none
- `console_errors`: surfaces `console`, requires none

- `node_modules/@jskit-ai/realtime-contracts/src/shared/appTopics.js:66`
- `node_modules/@jskit-ai/realtime-contracts/src/shared/appTopics.js:150`

### 12.2 Permission evaluation semantics for topics

Topic permission enforcement uses:

- `requiredAnyPermission` or `requiredAnyPermissionBySurface` (if surface-specific)
- wildcard `"*"` in permission set bypasses checks
- missing topic or missing surface -> reject

- `node_modules/@jskit-ai/realtime-contracts/src/shared/topicCatalog.js:55`
- `node_modules/@jskit-ai/realtime-contracts/src/shared/topicCatalog.js:142`
- `node_modules/@jskit-ai/realtime-contracts/src/shared/topicCatalog.js:163`

## 13. Realtime server runtime enforcement paths (shared runtime code)

The shared realtime runtime (`@jskit-ai/realtime-server-socketio`) is the enforcement engine that applies the topic rules and workspace context checks described above.

### 13.1 Handshake auth and surface normalization

Handshake flow:

- `resolveConnectionSurface` reads `?surface=` from websocket query and normalizes via `normalizeConnectionSurface`
- If surface is missing or unsupported, connection is rejected with `unsupported_surface`
- `authService.authenticateRequest` is called on the socket request context; if unauthenticated -> `unauthorized`
- On success, socket data is populated with `user`, `surface`, `requestContext`, and an empty subscription Map

- `node_modules/@jskit-ai/realtime-server-socketio/src/shared/registerRealtimeServerSocketio.js:151`
- `node_modules/@jskit-ai/realtime-server-socketio/src/shared/registerRealtimeServerSocketio.js:1203`

### 13.2 Subscribe enforcement order

Subscribe path enforces in this order:

1. Validate topic list (must be non-empty and supported).
2. Validate topic surface allowances (`isTopicAllowedForSurface`).
3. For workspace-scoped topics, enforce `workspaceSlug` presence.
4. Resolve workspace context using `workspaceService.resolveRequestContext` with `workspacePolicy: "required"` and `workspaceSurface: socket.surface`.
5. Validate topic permissions using `hasTopicPermission` for both workspace-scoped and user-scoped topics.
6. Join rooms and store subscriptions.

- `node_modules/@jskit-ai/realtime-server-socketio/src/shared/registerRealtimeServerSocketio.js:694`
- `node_modules/@jskit-ai/realtime-server-socketio/src/shared/registerRealtimeServerSocketio.js:754`
- `node_modules/@jskit-ai/realtime-server-socketio/src/shared/registerRealtimeServerSocketio.js:870`
- `node_modules/@jskit-ai/realtime-server-socketio/src/shared/registerRealtimeServerSocketio.js:1015`

### 13.3 Workspace context resolution is enforced for workspace topics only

`resolveSubscribeAuthorization` builds a subscribe context request (using the app-provided `buildSubscribeContextRequest`) and calls `workspaceService.resolveRequestContext` with `workspacePolicy: "required"` and the socket surface.

If workspace context fails or is missing, the subscribe is rejected with `forbidden`.

- `node_modules/@jskit-ai/realtime-server-socketio/src/shared/registerRealtimeServerSocketio.js:600`
- `node_modules/@jskit-ai/realtime-server-socketio/src/shared/registerRealtimeServerSocketio.js:789`

### 13.4 Permission enforcement uses topic-level rules, not route-level permissions

Topic permission checks are performed by `hasTopicPermission` with the resolved `context.permissions` and the socket surface. This means:

- the RBAC manifest drives permissions at workspace context level
- the realtime topic registry drives which permission strings apply to each topic

- `node_modules/@jskit-ai/realtime-server-socketio/src/shared/registerRealtimeServerSocketio.js:682`
- `node_modules/@jskit-ai/realtime-server-socketio/src/shared/registerRealtimeServerSocketio.js:829`

### 13.5 Fanout re-checks permissions per event

Before delivering workspace-scoped events, the runtime re-resolves workspace context and re-checks topic permissions:

- `canSocketReceiveEvent` revalidates surface, user, workspace slug/id match
- permission mismatch or missing workspace -> `evict` subscription
- transient or unexpected errors can skip delivery without eviction

- `node_modules/@jskit-ai/realtime-server-socketio/src/shared/registerRealtimeServerSocketio.js:650`
- `node_modules/@jskit-ai/realtime-server-socketio/src/shared/registerRealtimeServerSocketio.js:1182`

### 13.6 Targeted event fanout paths

Targeted events have three paths:

- User-scoped topics: deliver to `u:{id}:t:{topic}` rooms with surface validation and eviction for unsupported surfaces.
- Workspace-scoped targeted events: only deliver to sockets that have the workspace-topic subscription, then re-authorize via `canSocketReceiveEvent`.
- Global targeted events: deliver to user rooms with optional topic surface validation (no workspace context).

- `node_modules/@jskit-ai/realtime-server-socketio/src/shared/registerRealtimeServerSocketio.js:1316`
- `node_modules/@jskit-ai/realtime-server-socketio/src/shared/registerRealtimeServerSocketio.js:1370`
- `node_modules/@jskit-ai/realtime-server-socketio/src/shared/registerRealtimeServerSocketio.js:1520`

# Console Permission Model - Context Dump (Expanded Scan)

This file captures my current understanding after additional source reads; new addenda include explicit file references with line numbers.

## Scope I traced

Primary packages requested:

- `packages/workspace/workspace-console-core`
- `packages/workspace/workspace-console-service-core`
- `packages/workspace/console-fastify-routes`
- `packages/workspace/console-errors-fastify-routes`

Critical app/runtime wiring I followed to understand actual enforcement:

- `apps/jskit-value-app/server/framework/routeModuleCatalog.js`
- `apps/jskit-value-app/server/framework/composeRoutes.js`
- `apps/jskit-value-app/server/fastify/registerApiRoutes.js`
- `apps/jskit-value-app/server/fastify/auth.plugin.js`
- `apps/jskit-value-app/server/runtime/actions/*`
- `apps/jskit-value-app/server/runtime/actions/contributors/consoleErrors.contributor.js`
- `apps/jskit-value-app/server/framework/actionContributorFragments.js`
- `apps/jskit-value-app/server/runtime/services.js`
- Action runtime and auth-policy framework packages:
  - `packages/runtime/action-runtime-core/*`
  - `packages/auth/fastify-auth-policy/*`
  - `packages/surface-routing/*`

This is important because actual permission enforcement is split across route policy, action runtime policy, and service checks.

---

## High-level model (what is enforcing what)

The permission model is layered:

1. **Fastify route policy layer** authenticates user and resolves request context.
2. **Action runtime layer** enforces channel/surface/visibility/permission metadata attached to action definitions.
3. **Service layer** re-checks access/permission for sensitive operations.
4. **DB constraints** enforce invariants (singleton root, singleton active console role, unique pending invite per email, etc.).

This is generally defense-in-depth (good), but there are places where one layer is intentionally permissive (e.g., public browser error ingestion).

## Console role and permission definitions (`workspace-console-core`)

File: `packages/workspace/workspace-console-core/src/shared/consoleRoles.js`

### Roles

- `console` (super-user)
  - `assignable: false`
  - `permissions: ["*"]`
- `devop`
  - `assignable: true`
  - Includes:
    - `console.errors.browser.read`
    - `console.errors.server.read`
    - `console.billing.events.read_all`
    - `console.billing.catalog.manage`
    - `console.billing.operations.manage`
    - `console.assistant.settings.manage`
    - `console.ai.transcripts.read_all`
    - `console.ai.transcripts.export_all`
- `moderator`
  - `assignable: true`
  - `permissions: ["console.content.moderate"]`

### Management permissions constants

- `console.members.view`
- `console.members.invite`
- `console.members.manage`
- `console.invites.revoke`
- `console.roles.view`

### Helpers

- `normalizeRoleId()` lowercases/trim
- `resolveRolePermissions(roleId)` returns role permissions
- `resolveAssignableRoleIds()` returns only assignable roles
- `hasPermission(permissionSet, permission)` supports wildcard `*`

Consequence: any `console` member has global allow in this domain due to wildcard.

## Root identity and bootstrap mechanics (`workspace-console-service-core`)

File: `packages/workspace/workspace-console-service-core/src/shared/services/consoleAccess.service.js`

### Root identity behavior

- Root user id stored in `console_root_identity` singleton row.
- `bootstrapRootIdentity()` will set root from first active `console` membership when root unset.
- `ensureRootMutationAllowed(actorUser, targetUserId)`:
  - if target is root user and actor is not root -> 403 "Only root can modify the root user."

### Auto-seeding first console member (critical)

`ensureInitialConsoleMember(userId)`:

- If user already has membership, returns it.
- If system has active members (`countActiveMembers > 0`), does nothing.
- If no active members, inserts user as role `console`, `status: active`, assigns root if unset.

This is called from `resolveRequestContext({ user })`, and that is used in auth/context resolution for console surface routes.

### Context resolution

`resolveRequestContext({ user })` returns:

- `membership` summary if active (`roleId`, `status`)
- `permissions` from role via `resolveRolePermissions`
- `hasAccess` bool
- `pendingInvites` only if user not active member

### Enforcement helpers

- `requireConsoleAccess(user)` -> 403 if not active member
- `requirePermission(user, permission)` -> require console access + permission

## Console service orchestration and role assignment constraints

File: `packages/workspace/workspace-console-service-core/src/shared/services/console.service.js`

### Key points

- Builds `roleCatalog` from `getRoleCatalog()`.
- Computes `assignableRoleIds` once from role definitions.
- `normalizeRoleForAssignment(roleId)`:
  - requires non-empty role
  - rejects role not in assignable set (400 "Role is not assignable")

This function is passed to both members and invites services, so assignment constraints are centralized.

### Service composition

- Creates access service (`createConsoleAccessService`) and wires `requirePermission` across:
  - members service
  - invites service
  - billing service factory

### Bootstrap payload

`buildBootstrapPayload({ user })` emits:

- session info
- membership
- `permissions`
- roleCatalog
- pendingInvites
- `isConsole`

This is UI-facing context, not enforcement itself.

### Core endpoint methods and checks

- `listRoles`: requires `console.roles.view`
- `getAssistantSettings`: requires console access
- `updateAssistantSettings`: requires `console.assistant.settings.manage`

## Members management rules

File: `packages/workspace/workspace-console-service-core/src/shared/services/consoleMembers.service.js`

- `listMembers`: requires `console.members.view`
- `updateMemberRole`: requires `console.members.manage`
  - validates `memberUserId`
  - calls `ensureRootMutationAllowed`
  - normalizes target role through assignable-role guard
  - requires target membership active
  - if existing role is `console`, blocks with 409 "Cannot change the console super-user role."

So even root cannot demote/change a `console` role through this path.

## Invite rules and redeem flow

File: `packages/workspace/workspace-console-service-core/src/shared/services/consoleInvites.service.js`

### Admin invite management

- `listInvites`: requires `console.members.view`
- `createInvite`: requires `console.members.invite`
- `revokeInvite`: requires `console.invites.revoke`

### Create invite

- email normalized, required
- role constrained through `normalizeRoleForAssignment` (assignable only)
- if target user already active member -> 409
- generates token, stores `tokenHash`
- returns plaintext token in `createdInvite`

### Redeem invite (self-service)

`respondToPendingInviteByToken({ user, inviteToken, decision })`:

- requires authenticated user id + email
- decision only `accept|refuse`
- token normalization + hash resolution
- lookup pending invite by hash and non-expired status
- invite email must match caller email
- refuse -> revoke invite
- accept -> activates membership with invite role and marks invite accepted

### Token model nuance

Uses `resolveInviteTokenHash()` from access-core; that accepts either:

- raw token -> hash(token)
- or prefixed hash token `inviteh_<sha256>` directly

Pending invites list encodes stored token hash into this prefixed format. That means hash-at-rest can be replayed as bearer-like token for the matching email account.

## Console repository constraints (DB + repository behavior)

### `console_memberships`

Migration: `apps/jskit-value-app/migrations/baseline-steps/20260220090000_create_console_memberships.cjs`

- unique `user_id`
- indexed by status and role/status
- generated column `active_console_singleton` for `(status='active' AND role_id='console')`
- unique index on that generated column enforces max one active console-role membership

Repository behavior:

- `findByUserId`, `findActiveByRoleId`, `listActive`, `countActiveMembers`
- `ensureActiveByUserId` upserts membership and sets status active

### `console_root_identity`

Migration: `20260220090200_create_console_root_identity.cjs`

- singleton semantics implemented in repository with fixed row id `1`
- `assignRootUserIdIfUnset` updates only `whereNull('user_id')`

### `console_invites`

Migration: `20260220090100_create_console_invites.cjs`

- unique `token_hash`
- generated `pending_email` unique for pending status => one pending invite per email

Repository filters pending invites by `status='pending'` and `expires_at > now`.

### `console_settings`

Singleton row table (`id=1`), features JSON.

### `console_browser_errors` / `console_server_errors`

Error log storage tables with created_at indexes and filter indexes.

## Console HTTP routes (`console-fastify-routes`)

File: `packages/workspace/console-fastify-routes/src/shared/routes.js`

All routes are `auth: "required"` in this package.

Endpoints include:

- bootstrap
- roles
- assistant settings read/update
- members list/update role
- invites list/create/revoke
- invitations pending/redeem
- AI transcripts list/detail/export
- billing settings/events/plans/products/provider-prices
- billing operational endpoints (refund/void/corrections/assignment/subscription ops)
- entitlement definition endpoints

The route package mostly defines schema/auth; fine-grained permission checks are not encoded as route `permission` metadata here. Those happen in action/service layers.

Controller (`controller.js`) maps each route to fixed action IDs via `actionExecutor.execute` and sets context `channel: "api"`.

For mutation-heavy billing commands it enforces idempotency header presence before action execution.

## Console-errors HTTP routes (`console-errors-fastify-routes`)

File: `packages/workspace/console-errors-fastify-routes/src/shared/routes.js`

Routes:

- GET list/get browser errors (`auth: required`)
- GET list/get server errors (`auth: required`)
- POST record browser error (`auth: public`, `csrfProtection: false`, rate limit)
- POST simulate server error (`auth: required`, rate limit)

Controller maps to action IDs:

- `console.errors.browser.list|get|record`
- `console.errors.server.list|get|simulate`

## Action-level permission enforcement (runtime)

Key files:

- `packages/runtime/action-runtime-core/src/shared/pipeline.js`
- `packages/runtime/action-runtime-core/src/shared/policies.js`
- `apps/jskit-value-app/server/runtime/actions/createActionRegistry.js`
- `apps/jskit-value-app/server/runtime/actions/buildExecutionContext.js`

### Pipeline order

For each action execution:

1. normalize context
2. enforce channel allowlist
3. enforce surface allowlist
4. enforce visibility (operator-only actions)
5. validate input schema
6. evaluate permission policy
7. enforce idempotency policy
8. execute handler

Permission evaluator supports:

- function policy (boolean/object result)
- array policy (all required permissions in `context.permissions`)

Wildcard `*` satisfies permission checks.

### Execution context surface resolution

`buildExecutionContext` resolves surface from:

- explicit surface parameter
- `request.surface`
- `x-surface-id` header
- fallback from pathname (`resolveSurfaceFromPathname`)

This matters because action definitions include `surfaces: ["console"]` etc.

## Action definitions relevant to console permissions

### Console core contributor

File: `packages/workspace/workspace-console-service-core/src/shared/actions/consoleCore.contributor.js`

Actions are `surfaces: ["console"]`, channels `api|internal`.

Permission mapping summary:

- `console.bootstrap.read` -> `requireAuthenticated`
- `console.roles.list` -> `requireAuthenticated` (service later requires `console.roles.view`)
- `console.settings.read` -> `requireAuthenticated` (service later requires console access)
- `console.settings.update` -> `console.assistant.settings.manage`
- `console.members.list` -> `console.members.view`
- `console.member.role.update` -> `console.members.manage`
- `console.invites.list` -> `console.members.view`
- `console.invite.create` -> `console.members.invite`
- `console.invite.revoke` -> `console.invites.revoke`
- `console.invitations.pending.list` -> `requireAuthenticated`
- `console.invite.redeem` -> `requireAuthenticated`

Realtime publish wrappers are added for command actions.

### Console billing contributor

File: `packages/billing/billing-service-core/src/shared/actions/consoleBilling.contributor.js`

All actions are `surfaces: ["console"]`.

Uses `CONSOLE_BILLING_PERMISSIONS`:

- read/events via `READ_ALL`
- catalog/config via `CATALOG_MANAGE`
- financial operations/mutations via `OPERATIONS_MANAGE`

Also appends `assistant_tool` channel for selected actions and enforces idempotency modes per action ID map.

### Console transcripts contributor

File: `packages/ai-agent/assistant-transcripts-core/src/shared/actions/consoleTranscripts.contributor.js`

All actions `surfaces: ["console"]`, require:

- list/messages: `console.ai.transcripts.read_all`
- export: `console.ai.transcripts.export_all`

### Console-errors contributor (app-local)

File: `apps/jskit-value-app/server/runtime/actions/contributors/consoleErrors.contributor.js`

All actions `surfaces: ["console"]`.

Permission mapping:

- browser list/get -> `console.errors.browser.read`
- server list/get/simulate -> `console.errors.server.read`
- browser record -> `allowPublic` (always true)

This contributor also publishes realtime updates after record/simulate.

## Fastify auth plugin and surface context wiring

Files:

- `apps/jskit-value-app/server/framework/routeModuleCatalog.js`
- `apps/jskit-value-app/server/framework/composeRoutes.js`
- `apps/jskit-value-app/server/fastify/registerApiRoutes.js`
- `apps/jskit-value-app/server/fastify/auth.plugin.js`
- `packages/auth/fastify-auth-policy/src/shared/plugin.js`

### Route defaults for console paths

`withConsoleRoutePolicy` applies to any versioned `/api/.../console...` path:

- `workspacePolicy: "optional"` (unless already set)
- `workspaceSurface: "console"` (unless already set)

### Auth/context resolution behavior

Auth plugin passes route meta into `fastify-auth-policy`.

In `resolveContext`:

- If requested surface is `console` and `consoleService.resolveRequestContext` exists:
  - use that
  - set request `membership` + `permissions` from console context
  - set `workspace: null`
- Else use workspace service context resolution.

This is the key branch that wires "console surface context" to console membership/permission model.

### Important practical effect

Because console routes default to surface `console`, requests hit console context resolution automatically. That means `ensureInitialConsoleMember()` side effects can happen on first authenticated access to console endpoints.

## Cross-domain enforcement context (console-relevant defaults)

These are shared enforcement behaviors that directly affect console safety, even though they live outside console-specific packages:

- `fastify-auth-policy` only enforces route permissions when `meta.permission` is non-empty. Console routes do not provide `permission` metadata, so there is no route-level RBAC-string check; enforcement relies on action runtime + service checks. Context resolution still runs because console routes set `workspacePolicy: optional`.
  - `packages/auth/fastify-auth-policy/src/shared/plugin.js:208`
  - `packages/auth/fastify-auth-policy/src/shared/plugin.js:220`
- Route metadata defaults are permissive (`auth: public`, `workspacePolicy: none`, empty permission). If a console route is added without explicit policy, it will default to public. This is a footgun mitigated only by action/service layers.
  - `packages/auth/fastify-auth-policy/src/shared/routeMeta.js:13`
- If console surface ever falls through to workspace context resolution, workspace service denies unsupported surfaces by default (`app`/`admin` only). That provides a fail-closed boundary between workspace and console surfaces.
  - `packages/workspace/workspace-service-core/src/shared/services/workspace.service.js:171`
  - `packages/workspace/workspace-service-core/src/shared/services/workspace.service.js:174`
  - `packages/workspace/workspace-service-core/src/shared/services/workspace.service.js:177`
- Action runtime enforces surface allowlists before permission checks. Workspace actions are declared only for `app`/`admin`, so they fail closed on console surface if invoked through action runtime.
  - `packages/runtime/action-runtime-core/src/shared/pipeline.js:104`
  - `packages/runtime/action-runtime-core/src/shared/pipeline.js:105`
  - `packages/workspace/workspace-service-core/src/shared/actions/workspace.contributor.js:94`
  - `packages/workspace/workspace-service-core/src/shared/actions/workspace.contributor.js:180`
- Execution context surface resolution uses explicit parameter, `request.surface`, `x-surface-id` header, then pathname fallback. This means internal callers or misconfigured routes can change the surface used by action runtime.
  - `apps/jskit-value-app/server/runtime/actions/buildExecutionContext.js:58`
  - `apps/jskit-value-app/server/runtime/actions/buildExecutionContext.js:70`
  - `apps/jskit-value-app/server/runtime/actions/buildExecutionContext.js:78`
  - `apps/jskit-value-app/server/runtime/actions/buildExecutionContext.js:80`

## Surface resolution primitives

- `packages/surface-routing/src/shared/appSurfaces.js`
- `packages/surface-routing/src/shared/paths.js`
- `packages/surface-routing/src/shared/registry.js`

Default registry includes:

- `app` prefix `""`, requiresWorkspace true
- `admin` prefix `"/admin"`, requiresWorkspace true
- `console` prefix `"/console"`, requiresWorkspace false

API path resolver maps `/api/v1/console/...` to surface `console` by prefix matching.

In app shared exports (`apps/jskit-value-app/shared/surfacePaths.js`), these defaults are re-exported and used by auth/runtime.

## Console-errors service permissions (`observability-core`)

File: `packages/observability/observability-core/src/shared/consoleErrors.service.js`

It has internal `requirePermission(user, permission)`:

- requires authenticated user id -> 401 if missing
- requires active console membership -> 403 otherwise
- resolves role permissions via `resolveRolePermissions`
- checks with `hasPermission`

Read/simulate endpoints require permissions:

- browser read -> `console.errors.browser.read`
- server read/simulate -> `console.errors.server.read`

`recordBrowserError` and `recordServerError` do not check membership/permission.

Given routing + action contributor choices, browser record is intentionally public ingestion.

## App runtime wiring (how dependencies connect)

- `apps/jskit-value-app/server/runtime/services.js`
- `apps/jskit-value-app/server/runtime/controllers.js`
- `apps/jskit-value-app/server/framework/actionContributorFragments.js`
- `apps/jskit-value-app/server/framework/moduleRegistry.js`

### Services

- `consoleService` built from:
  - memberships repo
  - invites repo
  - root repo
  - settings repo
  - user profiles repo
  - billing factory receiving `requirePermission`
- `consoleErrorsService` built from:
  - console memberships repo
  - console error logs repo
  - observability service

### Controllers

- console controller from `@jskit-ai/console-fastify-routes`
- consoleErrors controller from `@jskit-ai/console-errors-fastify-routes`

### Contributors

- console core contributor (`workspace-console-service-core`)
- console billing contributor (`billing-service-core`)
- console transcripts contributor (`assistant-transcripts-core`)
- app-local console-errors contributor

### Modules

- `console` module: foundation
- `consoleErrors` module: feature, depends on auth + console

## Root user special rules summary

1. Root id is in singleton table and set only once (`assign if unset`).
2. Root mutation gate: only root actor can modify root user.
3. Member role update blocks changing any `console` role membership.
4. DB constraint allows only one active `console` role membership.

Combined effect: once seeded, root/super-user identity becomes very sticky and hard to rotate via normal member role path.

## Role assignment constraints summary

1. Assignments only to `assignableRoleIds` (`devop`, `moderator` currently).
2. `console` role cannot be assigned through invite/member update path.
3. Invite acceptance also passes through assignable-role normalization.
4. Invalid/non-assignable role gives 400 validation failure.

## Permission bypass/abuse risk summary (from what I read)

### Risk A: first-user bootstrap escalation on empty system

- Trigger path: authenticated console request -> auth plugin console context -> console access service -> `ensureInitialConsoleMember`
- If no active console members, caller is promoted to `console` and root.

### Risk B: public browser error ingestion abuse

- `/api/console/errors/browser` is public + CSRF off + allowPublic action.
- Main protections are payload normalization and rate limiting, not authz.
- Abuse class: spam/log poisoning/DoS pressure.

### Risk C: invite hash replay semantics

- Pending invite API returns encoded hash token.
- Redeem accepts encoded hash directly.
- If token hash leaks from storage/logs/API telemetry, it is usable by matching email account.

### Risk D: internal actor override via `input.user`

- Contributor helpers resolve user from payload first.
- On API routes this is mostly schema-constrained, but internal callers could misuse this if not guarded.

## Positive controls observed

- Multiple enforcement layers (route auth, action runtime, service checks).
- Action runtime enforces surface/channel strictness.
- Service-level re-checks prevent relying solely on contributor metadata.
- DB constraints enforce critical identity uniqueness invariants.
- Non-assignable super-user role protected at model/service level.

## Tests I observed that reinforce behavior

- `apps/jskit-value-app/tests/consoleRootSecurity.test.js`
  - verifies root singleton behavior
  - verifies non-root cannot modify root
  - verifies role immutability of console super-user
- `apps/jskit-value-app/tests/consoleRoutePolicyDefaults.test.js`
  - verifies console routes default to `workspacePolicy: optional`, `workspaceSurface: console`
- `apps/jskit-value-app/tests/authPluginInternals.test.js`
  - verifies console context branch in auth plugin is chosen for console surface
- `apps/jskit-value-app/tests/consoleErrorsService.test.js`
  - verifies permission checks for browser/server read
  - verifies simulated errors permission requirement and behavior

## Practical enforcement flow (end-to-end)

1. Fastify route matches console endpoint.
2. Composed route metadata marks it console surface (optional workspace policy).
3. Auth plugin authenticates and resolves context via console service.
4. Request gets `request.membership` + `request.permissions` from console role.
5. Controller dispatches fixed action ID with `channel: api`.
6. Action runtime validates:
   - action exists
   - channel allowed
   - surface allowed
   - permission policy passes
7. Action execute calls service method.
8. Service method re-checks permission/access and applies business constraints.
9. Repository/DB writes run under table/index invariants.

## Tight summary of who can do what (based on current role catalog)

- `console` role: everything (`*`), cannot be assigned via normal APIs.
- `devop` role:
  - console errors read (browser/server)
  - billing read/manage/operations
  - assistant settings manage
  - AI transcripts read/export
- `moderator` role:
  - only `console.content.moderate` (currently does not include member/invite/error/billing permissions)

Management operations (`members`, `invites`, `roles`) require dedicated `console.members.*`, `console.invites.revoke`, `console.roles.view`; those are effectively available only to `console` wildcard currently unless additional roles are added with those perms.

## Observed design intent

- Console is modeled as its own non-workspace surface with dedicated membership and role catalog.
- Authorization is intended to be centralized in action metadata + service checks, not in route definitions.
- `console` super-user is deliberately non-assignable and singleton active.
- Console-errors browser ingestion is intentionally unauthenticated telemetry ingestion.

## If I had to harden quickly (from this context only)

1. Gate first-root bootstrap behind explicit setup flag/admin allowlist, not first authenticated console hit.
2. For public browser error endpoint, add stronger abuse controls:
   - tighter burst limits per IP/user-agent
   - size caps / drop heuristics
   - optional origin/API key checks for production
3. Stop accepting hash-form invite tokens for redemption, or bind with short-lived signed wrapper.
4. In contributor/user resolution helpers, ignore `input.user` on `channel: api`.
5. Consider adding route-level `permission` metadata for the most sensitive console endpoints as early reject/defense-in-depth.

## Addenda: Line-Anchored Details (Expanded Scan)

### Console roles, helpers, and default invite role

- Role definitions (`console`, `devop`, `moderator`) plus their assignability and permission arrays are in `packages/workspace/workspace-console-core/src/shared/consoleRoles.js:1-39`.
- Management permissions (`console.members.view`, `console.members.invite`, `console.members.manage`, `console.invites.revoke`, `console.roles.view`) are centralized in `consoleRoles.js:41-47`.
- `hasPermission` returns `true` for an empty required permission string, and otherwise matches `*` or exact string (`consoleRoles.js:91-99`).
- Default invite role is `moderator`, and assignable roles come from the `assignable` flag (`consoleRoles.js:101-106`).
- Unknown role IDs resolve to empty permissions (`consoleRoles.js:77-88`), which makes auth-only checks pass while RBAC-string checks fail closed.

### Console access service (root + bootstrap details)

- Root id is loaded via `findRootUserId`, and `bootstrapRootIdentity` backfills it from the first active `console` role membership (`consoleAccess.service.js:24-45`).
- `ensureRootMutationAllowed` blocks non-root actors from modifying the root user (`consoleAccess.service.js:48-58`).
- `ensureInitialConsoleMember` assigns root when an existing active `console` membership is found and root is unset (`consoleAccess.service.js:71-81`, `112-120`).
- `ensureInitialConsoleMember` stops without seeding when there is at least one active member (`consoleAccess.service.js:85-88`).
- `ensureInitialConsoleMember` inserts a `console` role membership and assigns root when no active members exist and root is unset or matches the user (`consoleAccess.service.js:94-104`).
- Duplicate insert errors are ignored and the membership is reloaded (`consoleAccess.service.js:105-122`).
- `resolveRequestContext` always runs `ensureInitialConsoleMember` for authenticated users and only treats `status === \"active\"` as access (`consoleAccess.service.js:126-149`).
- `requireConsoleAccess` and `requirePermission` both throw 403 on failure (`consoleAccess.service.js:152-167`).

### Console service orchestration and assignment constraints

- `normalizeRoleForAssignment` enforces a non-empty role and requires the role be in `assignableRoleIds`, otherwise 400 with field errors (`console.service.js:86-107`).
- `buildBootstrapPayload` emits `session` info (userId/username), role catalog, permissions, and `isConsole` (active membership) (`console.service.js:191-218`).
- `listRoles` requires `console.roles.view` (`console.service.js:221-225`).
- `getAssistantSettings` requires console access (`console.service.js:228-231`).
- `updateAssistantSettings` requires `console.assistant.settings.manage` and validates the `assistantSystemPromptWorkspace` field, length limit, and then patches settings (`console.service.js:234-257`).

### Members service enforcement details

- `listMembers` requires `console.members.view` and returns a role catalog snapshot with members (`consoleMembers.service.js:13-20`).
- `updateMemberRole` requires `console.members.manage`, validates `memberUserId`, enforces root mutation rule, normalizes role, and refuses to change the `console` super-user role (`consoleMembers.service.js:23-47`).

### Invites service flow and TTL

- Pending invites are only exposed to users without an active console membership, and the returned token is the encoded hash (`inviteh_...`) via `encodeInviteTokenHash` (`consoleInvites.service.js:60-81`).
- Invite creation requires `console.members.invite` (`consoleInvites.service.js:93-95`).
- Invite creation normalizes email and uses default invite role when omitted (`consoleInvites.service.js:96-107`).
- Invite creation blocks inviting an already-active console member (`consoleInvites.service.js:108-113`).
- Invite creation generates a plaintext token via `buildInviteToken`, stores `tokenHash`, sets `expiresAt` from policy, status `pending` (`consoleInvites.service.js:116-133`).
- Duplicate pending invites for the same email return 409 (`consoleInvites.service.js:135-139`).
- Invite creation returns plaintext `token` in the `createdInvite` payload (`consoleInvites.service.js:150-158`).
- Invite redemption requires authenticated user and email (`consoleInvites.service.js:185-189`).
- Invite redemption validates decision and token, resolves hash via `resolveInviteTokenHash`, and enforces email match (`consoleInvites.service.js:191-234`).
- Accept path normalizes the role and activates membership (`ensureActiveByUserId`) before marking invite accepted (`consoleInvites.service.js:245-248`).
- Invite TTL is 72 hours (`invitePolicy.js:1-6`).

### Invite token hashing semantics (hash replay risk)

- `buildInviteToken` uses `crypto.randomBytes(24)` -> 48 hex chars (`inviteTokens.js:13-15`).
- `encodeInviteTokenHash` only returns a token for valid SHA-256 hex and prefixes with `inviteh_` (`inviteTokens.js:21-30`).
- `resolveInviteTokenHash` accepts the `inviteh_` hash form directly or hashes raw tokens, so the hash form can be replayed as a bearer token when combined with the email check (`inviteTokens.js:32-43`).

### Repository + migration constraints

- `console_memberships` status enum is `active|suspended` (`20260220090000_create_console_memberships.cjs:6`).
- `console_memberships` enforces unique `user_id` and indexes by `status` and `(role_id,status)` (`20260220090000_create_console_memberships.cjs:11-13`).
- `console_memberships` has `active_console_singleton` generated column and unique index enforcing a single active `console` membership (`20260220090000_create_console_memberships.cjs:16-25`).
- `console_invites` status enum is `pending|accepted|revoked|expired`, token hash is unique (`20260220090100_create_console_invites.cjs:6-10`).
- `console_invites` uses `pending_email` generated column + unique index to enforce one pending invite per email (`20260220090100_create_console_invites.cjs:18-27`).
- `console_root_identity` is a singleton row keyed by id with unique user id (`20260220090200_create_console_root_identity.cjs:2-10`).
- `console_browser_errors` and `console_server_errors` are indexed by timestamps and filters to support query pagination (`20260220100000_create_console_browser_errors.cjs:2-23`, `20260220100100_create_console_server_errors.cjs:26-44`).
- Membership repository `listActive` joins `user_profiles` for display name/email and sorts (`memberships.repository.js:66-85`).
- Membership repository `ensureActiveByUserId` inserts or updates role + status to `active` (`memberships.repository.js:111-139`).
- Invites repository pending list filters `status = pending` and `expires_at > now` (`invites.repository.js:84-92`).
- Invites repository token-hash lookup enforces `status = pending` and `expires_at > now` (`invites.repository.js:127-142`).
- Invites repository `expirePendingByEmail` only expires already-expired invites (does not revoke still-valid invites) (`invites.repository.js:169-187`).
- Root repository uses `whereNull(\"user_id\")` to enforce assign-if-unset root write (`root.repository.js:73-79`).

### Console HTTP route contracts and rate limits

- All console core routes are `auth: \"required\"` and use schema validation; e.g., bootstrap/roles/settings/members/invites/transcripts/billing are defined in `console-fastify-routes/src/shared/routes.js:6-621`.
- `POST /api/console/invites` has rate limiting (max 20 per minute) (`console-fastify-routes/src/shared/routes.js:558-575`).
- `POST /api/console/errors/browser` is `auth: \"public\"` and `csrfProtection: false` with 120/min rate limit (`console-errors-fastify-routes/src/shared/routes.js:75-93`).
- `POST /api/console/simulate/server-error` is `auth: \"required\"` with 30/min rate limit (`console-errors-fastify-routes/src/shared/routes.js:97-114`).
- Invite token length min 16/max 256 is enforced in schema (`console-fastify-routes/src/shared/schema.js:58-65`, `123-125`, `190-194`).
- Member and invite params enforce numeric string patterns (`console-fastify-routes/src/shared/schema.js:252-268`).
- Assistant settings update requires `assistantSystemPromptWorkspace` max 4000 and `minProperties: 1` (`console-fastify-routes/src/shared/schema.js:216-223`).

### Console controller idempotency requirements for billing mutations

- `requireIdempotencyKey` enforces `Idempotency-Key` header and throws a 400 with `IDEMPOTENCY_KEY_REQUIRED` (`console-fastify-routes/src/shared/controller.js:44-55`).
- The controller requires this header for refund/void/corrections, plan assignment mutations, and subscription change/cancel endpoints (`console-fastify-routes/src/shared/controller.js:292-399`, `414-461`).
- Other console billing actions (list/read/create/update) do not call `requireIdempotencyKey` in the controller; idempotency is enforced in action runtime based on action metadata.

### Action contributors (line-anchored permission mappings)

- Core console contributor actions are `surfaces: [\"console\"]` and `channels: [\"api\",\"internal\"]` (`consoleCore.contributor.js:77-176`).
- `console.roles.list` is `requireAuthenticated`, but service still enforces `console.roles.view` (`consoleCore.contributor.js:99-113`, `console.service.js:221-223`).
- `console.settings.update` requires `console.assistant.settings.manage` (`consoleCore.contributor.js:135-143`).
- `console.members.list` and `console.member.role.update` require `console.members.view/manage` (`consoleCore.contributor.js:153-179`).
- `console.invite.create` and `console.invite.revoke` require `console.members.invite` and `console.invites.revoke` (`consoleCore.contributor.js:211-245`).
- Pending invite list and redemption are auth-only (`consoleCore.contributor.js:248-288`).
- Core contributor realtime topics/events are mapped by action id prefixes and applied to command actions (`consoleCore.contributor.js:15-52`, `301-321`).
- `console.billing.settings.read` and `.update` require `console.billing.catalog.manage` (`consoleBilling.contributor.js:542-576`).
- `console.billing.events.list` requires `console.billing.events.read_all` (`consoleBilling.contributor.js:580-595`).
- Catalog list/create/update actions require `console.billing.catalog.manage` (`consoleBilling.contributor.js:598-699`).
- Operational actions (purchases list/refund/void/corrections) require `console.billing.operations.manage` (`consoleBilling.contributor.js:977-1078`).
- Idempotency modes are explicitly defined per action id (`consoleBilling.contributor.js:98-133`).
- The billing contributor can add `assistant_tool` channel definitions for console billing actions (`consoleBilling.contributor.js:184-485`).
- Console transcripts list/messages require `console.ai.transcripts.read_all`, export requires `console.ai.transcripts.export_all` (`consoleTranscripts.contributor.js:42-96`).
- Console errors list/get require `console.errors.browser.read` or `console.errors.server.read` (`consoleErrors.contributor.js:56-134`).
- Console errors browser record is always allowed (`allowPublic`) (`consoleErrors.contributor.js:32-35`, `137-174`).

### Auth policy and action runtime guardrails (line-anchored)

- `withConsoleRoutePolicy` applies `workspacePolicy: \"optional\"` and `workspaceSurface: \"console\"` to `/api/console` routes (`routeModuleCatalog.js:107-119`) and is applied to composed routes (`composeRoutes.js:29-42`).
- Auth plugin resolves console context when requested surface is console, setting `workspace: null` and permissions from console membership (`auth.plugin.js:80-99`).
- Route meta defaults are permissive (`auth: public`, `workspacePolicy: none`, empty permission) (`routeMeta.js:13-22`).
- `fastify-auth-policy` only resolves context when `workspacePolicy !== none` or `permission` is non-empty, and only enforces permission checks when `meta.permission` is set (`plugin.js:207-242`).
- Action runtime enforces channel, surface, and visibility before permission checks (`pipeline.js:104-115`, `policies.js:80-107`).
- Operator visibility requires `actor.isOperator` or permission `console.operator` or `*` (`policies.js:110-120`).
- Permission evaluation uses `*` or exact match; empty required permission returns allow (`policies.js:11-22`, `27-73`).

### Surface routing details

- Default surfaces include `console` with prefix `/console` and `requiresWorkspace: false` (`appSurfaces.js:5-20`).
- `resolveSurfaceFromApiPathname` matches surface prefixes under the API namespace; console paths under `/api/v1/console` resolve to `console` (`paths.js:104-118`).
- `resolveSurfaceFromPathname` checks API surface first, then path prefixes, else defaults to the fallback surface (`paths.js:120-138`).

### User resolution in action helpers (potential misuse vectors)

- Core action helper `resolveUser` prefers `input.user` over request or actor (`actionContributorHelpers.js:29-33`).
- Console billing and console transcripts contributors use the same pattern (`consoleBilling.contributor.js:31-34`, `consoleTranscripts.contributor.js:15-18`).
- Console errors contributor also accepts `input.user`, which means public error ingestion can spoof `user` attribution if inputs are not scrubbed at the edge (`consoleErrors.contributor.js:22-25`, `137-155`).

### Console errors ingestion normalization (public endpoint hardening context)

- Browser-side error payload tools build the default payload with `occurredAt`, `source`, `url`, `path`, `surface` (resolved from pathname), and `userAgent` (`browserPayload.js:37-48`).
- `createPayloadFromErrorEvent` captures `errorName`, `message`, stack, line/column, and metadata filename (`browserPayload.js:52-65`).
- `createPayloadFromRejectionEvent` stringifies non-Error reasons and emits `reasonType` metadata (`browserPayload.js:68-86`).
- Server-side payload normalization truncates and normalizes strings, stacks, and metadata; nested objects are collapsed to `"[object]"` and arrays are truncated (`serverPayload.js:17-79`).
- Browser payload normalization caps field lengths and derives `userId` and `username` from provided user context (`serverPayload.js:90-109`).
- Server payload normalization sets `statusCode` default 500 and normalizes `userId`/`username` (`serverPayload.js:112-126`).
- Simulation kind normalizer cycles through `SERVER_SIMULATION_KINDS` when `kind` is empty or `auto` (`serverPayload.js:129-141`).

### Console errors API client shape

- Console errors client calls `/api/v1/console/errors/browser` for public report and `/api/v1/console/simulate/server-error` for server simulations (`consoleErrorsApi.js:25-30`).

### Console errors service behavior details (permission and metrics)

- `requirePermission` enforces authentication and active console membership before read operations (`consoleErrors.service.js:64-85`).
- Browser/server read list methods clamp pagination to safe page bounds (`consoleErrors.service.js:87-107`, `120-139`).
- `recordBrowserError` and `recordServerError` normalize payloads and emit observability ingestion metrics on success/failure (`consoleErrors.service.js:153-186`).
- `simulateServerError` throws different error types based on `kind` and embeds a `simulationId` marker in error messages (`consoleErrors.service.js:189-215`).

# Permission Enforcement Deep-Dive (Billing / Social / Chat)

This document is a full memory dump of what I already read about permission enforcement in this repo, without re-reading files.

## Scope I covered

- Billing routes and controller:
  - `packages/billing/billing-fastify-routes/src/shared/routes.js`
  - `packages/billing/billing-fastify-routes/src/shared/controller.js`
- Billing action and service policy layers:
  - `packages/billing/billing-service-core/src/shared/actions/workspaceBilling.contributor.js`
  - `packages/billing/billing-service-core/src/shared/policy.service.js`
  - `packages/billing/billing-service-core/src/shared/service.js`
  - `packages/billing/billing-service-core/src/shared/checkoutOrchestrator.service.js`
  - `apps/jskit-value-app/tests/billingRoutesPolicy.test.js`
- Social routes and action/service layers:
  - `packages/social/social-fastify-routes/src/shared/routes.js`
  - `packages/social/social-fastify-routes/src/shared/controller.js`
  - `packages/social/social-core/src/shared/actions/social.contributor.js`
  - `packages/social/social-core/src/shared/service.js`
- Chat routes and action/service layers:
  - `packages/chat/chat-fastify-routes/src/shared/routes.js`
  - `packages/chat/chat-fastify-routes/src/shared/controller.js`
  - `packages/chat/chat-core/src/shared/actions/chat.contributor.js`
  - `packages/chat/chat-core/src/shared/service.js`
- Shared auth/workspace/action runtime path:
  - `apps/jskit-value-app/server/fastify/registerApiRoutes.js`
  - `packages/auth/fastify-auth-policy/src/shared/routeMeta.js`
  - `packages/auth/fastify-auth-policy/src/shared/plugin.js`
  - `apps/jskit-value-app/server/fastify/auth.plugin.js`
  - `apps/jskit-value-app/server/runtime/actions/index.js`
  - `apps/jskit-value-app/server/runtime/actions/buildExecutionContext.js`
  - `packages/runtime/action-runtime-core/src/shared/pipeline.js`
  - `packages/runtime/action-runtime-core/src/shared/policies.js`
- Workspace context provider:
  - `packages/workspace/workspace-service-core/src/shared/lookups/workspaceRequestContext.js`
  - `packages/workspace/workspace-service-core/src/shared/services/workspace.service.js`
  - `packages/workspace/workspace-console-service-core/src/shared/services/console.service.js`
  - `packages/workspace/workspace-console-service-core/src/shared/services/consoleAccess.service.js`

## End-to-end enforcement pipeline

### 1. Route metadata definitions

Routes define `auth`, `workspacePolicy`, `workspaceSurface`, and optionally `permission`.

- Normalized defaults are in `routeMeta.js`:
  - `authPolicy: public`, `workspacePolicy: none`, `workspaceSurface: ""`, `permission: ""`
  - `packages/auth/fastify-auth-policy/src/shared/routeMeta.js:13`

### 2. Route registration copies metadata into Fastify `config`

- `registerApiRoutes` maps route fields to auth policy config via `mergeAuthPolicy(...)`.
  - `apps/jskit-value-app/server/fastify/registerApiRoutes.js:19`

### 3. Auth prehandler enforces auth and route-level permission

- Prehandler initialization and request decorations:
  - `request.user`, `request.workspace`, `request.membership`, `request.permissions`
  - `packages/auth/fastify-auth-policy/src/shared/plugin.js:118`
- If route is non-public, it authenticates actor and sets `request.user`.
  - `packages/auth/fastify-auth-policy/src/shared/plugin.js:138`
- Context resolution runs when either:
  - `workspacePolicy !== none` OR `permission` exists
  - `packages/auth/fastify-auth-policy/src/shared/plugin.js:208`
- Context result fills:
  - `request.workspace`, `request.membership`, `request.permissions`
  - `packages/auth/fastify-auth-policy/src/shared/plugin.js:215`
- Route permission is checked only if `meta.permission` is non-empty.
  - `packages/auth/fastify-auth-policy/src/shared/plugin.js:220`

### 4. App-specific context resolver

- `auth.plugin.js` decides surface and context source:
  - console surface: `consoleService.resolveRequestContext(...)`
  - other surfaces: `workspaceService.resolveRequestContext(...)`
  - `apps/jskit-value-app/server/fastify/auth.plugin.js:80`
- Route permission check function delegates to RBAC `hasPermission`.
  - `apps/jskit-value-app/server/fastify/auth.plugin.js:113`

### 5. Action runtime carries request context and does action permission eval

- Controllers call `actionExecutor.execute` with `context: { request, channel: "api" }`.
  - Billing: `packages/billing/billing-fastify-routes/src/shared/controller.js:42`
  - Social: `packages/social/social-fastify-routes/src/shared/controller.js:31`
  - Chat: `packages/chat/chat-fastify-routes/src/shared/controller.js:101`
- `buildExecutionContext` pulls from `request`:
  - actor from `request.user`
  - workspace from `request.workspace`
  - membership from `request.membership`
  - permissions from `request.permissions`
  - `apps/jskit-value-app/server/runtime/actions/buildExecutionContext.js:78`
- Action pipeline enforces:
  - channel
  - surface
  - visibility
  - permission policy
  - `packages/runtime/action-runtime-core/src/shared/pipeline.js:104`
- Permission policy behavior:
  - function policy -> boolean/object resolution
  - array policy -> all permissions required via `hasPermission`
  - `packages/runtime/action-runtime-core/src/shared/policies.js:27`

## Workspace context and permission source of truth

### Workspace service context resolution

- `resolveRequestContext({ user, request, workspacePolicy, workspaceSurface })`
  - `packages/workspace/workspace-service-core/src/shared/services/workspace.service.js:766`
- If unauthenticated user:
  - returns empty context (`workspace: null`, `permissions: []`)
  - `workspace.service.js:768`
- Surface resolution order:
  - explicit `workspaceSurface` (from route metadata)
  - `x-surface-id` header
  - pathname-derived surface
  - `workspaceRequestContext.js:34`
- Requested workspace slug resolution:
  - `x-workspace-slug` header, then query, then params
  - `workspaceRequestContext.js:56`
- If `workspacePolicy === "required"` and no selected workspace:
  - throws `409 Workspace selection required`
  - `workspace.service.js:793`
- On success returns:
  - selected workspace summary
  - selected membership summary
  - selected permission set
  - accessible workspace list
  - user settings
  - `workspace.service.js:797`

### How workspace permissions are derived

- `resolvePermissions(roleId)`:
  - owner role -> `["*"]`
  - otherwise RBAC role permissions
  - `workspace.service.js:489`
- Access evaluators:
  - app surface: active membership + app-surface deny policy checks from workspace settings
  - admin surface: active membership
  - console surface in default resolver: deny workspace access
  - `workspace.service.js:79`, `workspace.service.js:136`, `workspace.service.js:158`

### Console context path

- Console context does not use workspace selection.
- `consoleAccess.resolveRequestContext({ user })` returns:
  - console membership summary
  - console permissions from console role
  - `hasAccess`
  - pending invites when no active console membership
  - `packages/workspace/workspace-console-service-core/src/shared/services/consoleAccess.service.js:126`

## Billing: exact enforcement behavior

## Billing route metadata

All billing API routes are authenticated and workspace-optional, with no route `permission`.

- Examples:
  - plans: `routes.js:10`
  - checkout: `routes.js:179`
  - portal: `routes.js:229`
  - payment links: `routes.js:247`
- No route `permission` fields on these endpoints.
- Stripe/Paddle webhooks are public and workspace-agnostic:
  - `routes.js:263`, `routes.js:279`

Test coverage confirms intent:

- Billing write routes explicitly asserted to have `permission === undefined`
  - `apps/jskit-value-app/tests/billingRoutesPolicy.test.js:69`

## Billing controller path

- Routes call billing action IDs through action executor.
  - `controller.js:3`, `controller.js:38`
- Mutation routes require `Idempotency-Key` header in controller for several operations:
  - `requireIdempotencyKey` helper
  - `controller.js:27`

## Billing action-level permission

- Shared action permission function:
  - `requireWorkspaceBillingManageOrSelf`
  - `workspaceBilling.contributor.js:85`
- Logic:
  - requires authenticated actor
  - if no workspace selected -> allow (`true`)
  - if workspace selected -> require `workspace.billing.manage` in context permissions
  - `workspaceBilling.contributor.js:93`
- Billing actions are admin-surface actions:
  - e.g. `surfaces: ["admin"]`
  - `workspaceBilling.contributor.js:266`
- All billing actions use the same permission function:
  - e.g. `workspaceBilling.contributor.js:269`, `:290`, `:311`, `:533`, `:600`

## Billing service-level policy (main hard authorization)

Policy service exposes:

- `resolveBillableEntityForReadRequest`
  - `policy.service.js:292`
- `resolveBillableEntityForWriteRequest`
  - `policy.service.js:327`

Selector behavior:

- Workspace selector from:
  - `x-workspace-slug`, params `workspaceSlug`, query `workspaceSlug`
  - `policy.service.js:16`
- Billable entity selector from:
  - `x-billable-entity-id`, params/query `billableEntityId`
  - `policy.service.js:35`

Write enforcement:

- `assertBillingWritePermission(workspace)` enforces `workspace.billing.manage`.
  - `policy.service.js:276`
- Used in write flows:
  - selected workspace entity path
  - `resolveBillableEntityForWriteRequest` workspace branch
  - `policy.service.js:346`

Important fallback behavior:

- If no workspace selector and no billable-entity selector, write resolves to user-scoped billable entity.
  - `policy.service.js:356`

Entity-by-ID selector behavior:

- If entity type is workspace:
  - verifies user has membership in that workspace
  - write branch enforces write permission via role
  - `policy.service.js:243`, `:254`
- If entity type is user:
  - verifies ownership (`ownerUserId == user.id`)
  - `policy.service.js:262`

## Billing service methods and policy usage

Service requires `billingPolicyService` dependency:

- `service.js:493`

Read methods use read policy resolver:

- `listPlans` `service.js:689`
- `listProducts` `service.js:737`
- `listPurchases` `service.js:767`
- `getPlanState` `service.js:1389`
- `listPaymentMethods` `service.js:2706`
- `getLimitations` `service.js:3120`
- `listTimeline` `service.js:3155`

Write methods use write policy resolver:

- `requestPlanChange` `service.js:1406`
- `cancelPendingPlanChange` `service.js:1706`
- `syncPaymentMethods` `service.js:2724`
- payment-method write resolution path (`resolvePaymentMethodForWrite`) `service.js:2970`
- `createPortalSession` `service.js:3361`
- `createPaymentLink` `service.js:4003`

Checkout path:

- Billing service `startCheckout` delegates to orchestrator
  - `service.js:4248`
- Orchestrator itself resolves write billable entity
  - `checkoutOrchestrator.service.js:1641`

## Social: exact enforcement behavior

## Social route metadata

Workspace routes have explicit route permission metadata.

- App surface + required workspace + `social.read` or `social.write`
  - feed read: `routes.js:37` + `routes.js:40`
  - create post: `routes.js:57` + `routes.js:60`
  - many similar entries through notifications and actor routes
- Moderation routes:
  - admin surface + required workspace + `social.moderate`
  - `routes.js:284`, `routes.js:287`
- Federation routes:
  - public + workspace none + csrf false
  - `routes.js:338`, `routes.js:357`, `routes.js:437`

## Social controller path

- All endpoints execute action IDs with request context through action runtime.
  - `controller.js:27`

## Social action-level permission

Most social actions enforce:

- authenticated actor
- workspace context present
- via function policy `hasAll([requireAuthenticated, requireWorkspaceContext], context)`
- `social.contributor.js:95` and repeated across core actions

Moderation actions:

- permission is config-driven by `moderationAccessMode`:
  - if `"operator"` -> `permission: () => true`
  - else -> `permission: ["social.moderate"]`
  - `social.contributor.js:44`
- moderation action entries use this:
  - `social.contributor.js:508`, `:530`, `:552`

Federation actions:

- `permission: () => true`
- includes webfinger, actor doc, followers/following/outbox/object, inbox processing
- `social.contributor.js:575`, `:597`, `:619`, `:641`, `:663`, `:685`, `:707`, `:731`

## Social service behavior

Service validates auth/workspace presence locally:

- `resolveWorkspaceId` throws 409 if missing
  - `service.js:51`
- `resolveActorUserId` throws 401 if missing
  - `service.js:60`

Methods call these early:

- `listFeed` -> `service.js:1228` and checks at `:1230`, `:1232`
- `getPost` -> checks at `:1275`, `:1276`
- `createPost` -> checks at `:1313`, `:1314`
- moderation methods similarly:
  - `listModerationRules` `:1872`
  - `createModerationRule` `:1886`
  - `deleteModerationRule` `:1929`

Notably absent in service:

- no direct `social.read`/`social.write`/`social.moderate` permission-string checks found in `social-core` service file.
- This means route metadata (prehandler) and action permission config carry most RBAC-string semantics for API usage.

## Chat: exact enforcement behavior

## Chat route metadata

All chat routes:

- `auth: "required"`
- `workspacePolicy: "none"`
- no route `permission`

Examples:

- ensure workspace room: `routes.js:37`
- list inbox: `routes.js:100`
- send message: `routes.js:167`
- add/remove reactions: `routes.js:318`, `routes.js:341`

## Chat controller path

- Routes map into chat action IDs via action executor.
  - `controller.js:97`

## Chat action-level permission

All chat actions use:

- `permission: requireAuthenticated`
- no action-level `chat.read` / `chat.write` array policy
- examples:
  - workspace room ensure `chat.contributor.js:104`
  - thread get `:192`
  - message send `:240`
  - attachment delete `:472`

All actions allow surfaces `["app", "admin", "console"]`:

- e.g. `chat.contributor.js:101`, `:122`, `:237`

## Chat service-level authorization (primary)

Manifest-aware permission gate:

- `shouldEnforceWorkspacePermission` uses `manifestIncludesPermission(...)`
  - `service.js:742`

Membership + permission check:

- `resolveWorkspaceMembershipAccess({ workspaceId, userId, requiredPermission })`
  - active membership required
  - if permission is not enforceable (missing manifest or permission absent in manifest), returns allowed with membership only
  - otherwise checks role permission set
  - `service.js:1021`

Thread access gate:

- `resolveThreadAccess(...)`
  - thread must exist
  - participant must be active
  - workspace threads:
    - workspace threads feature flag must be enabled
    - surface constraints apply
    - membership access + `chat.read`/`chat.write` check
  - global threads:
    - global DMs feature flag must be enabled
  - `service.js:1044`

Where it is called:

- read paths:
  - `getThread` `service.js:1750`
  - `listThreadMessages` `service.js:1809`
  - attachment content (indirect thread check) `service.js:2265`
  - mark read uses read mode `service.js:2558`
- write paths:
  - reserve attachment `service.js:1920`
  - upload attachment `service.js:2006`
  - delete attachment `service.js:2179`
  - send message `service.js:2332`
  - add reaction `service.js:2660`
  - remove reaction `service.js:2720`
  - typing emit `service.js:2777`

Workspace room creation path:

- `ensureWorkspaceRoom` pulls `lastActiveWorkspaceId` from user settings
- checks membership access with required `chat.read`
- `service.js:1412`, `:1417`

Inbox filtering behavior:

- `listInbox` fetches user threads, then filters:
  - keeps global threads
  - for workspace threads:
    - rejects console surface
    - requires active workspace id
    - requires thread workspace == active workspace id
- `service.js:1678`, `:1705`, `:1715`, `:1723`

## Route metadata presence vs absence (quick matrix)

- Billing routes:
  - `auth`: yes
  - `workspacePolicy`: yes (`optional` for user-facing billing, `none` for webhooks)
  - `workspaceSurface`: mostly absent
  - `permission`: absent on billing API routes
- Social routes:
  - workspace routes: `auth + workspacePolicy(required) + workspaceSurface + permission` all present
  - federation routes: public, no workspace policy, no route permission
- Chat routes:
  - `auth` yes
  - `workspacePolicy` yes (`none`)
  - `workspaceSurface` absent
  - `permission` absent

## What this means for actual enforcement location

- Billing:
  - Route prehandler does auth/context, but not route RBAC permission.
  - Billing RBAC is in action function + service policy service.
- Social:
  - Route prehandler has explicit RBAC permission checks for API routes.
  - Action layer mostly checks auth + workspace presence.
  - Service layer checks auth/workspace and domain validation, not explicit `social.read/write` RBAC strings.
- Chat:
  - Route prehandler only auth (no workspace context resolution because `workspacePolicy=none` and no route permission).
  - Action layer only requires authentication.
  - Service layer does thread/membership/permission authorization.

## Potential weak spots and risk notes

1) Billing relies on downstream checks instead of route-level permission metadata

- Evidence:
  - billing write routes have no route `permission`: `billingRoutesPolicy.test.js:69`
  - prehandler permission checks only trigger when `meta.permission` exists: `plugin.js:220`
- Risk:
  - If a new entrypoint bypasses billing action/service policy layer, route prehandler won’t block by permission string.

2) Billing write fallback to user-scoped billable entity when no selectors provided

- Evidence:
  - write resolver fallback: `policy.service.js:356`
  - action permission helper allows no-workspace-selected path: `workspaceBilling.contributor.js:93`
- Risk:
  - Behavior may be broader than teams expecting strict workspace-admin gating for all billing mutations.

3) Social RBAC-string checks concentrated at route layer

- Evidence:
  - route `permission` exists for core workspace social endpoints: `social-fastify-routes/routes.js`
  - actions mostly only require auth+workspace context: `social.contributor.js:95`
  - no explicit `social.read/write/moderate` checks in service file were found
- Risk:
  - Internal action invocations that bypass route metadata can skip `social.read/write` route-RBAC semantics unless caller adds equivalent checks.

4) Social moderation can be configured to bypass permission checks

- Evidence:
  - `moderationAccessMode === "operator"` leads to `permission: () => true`: `social.contributor.js:44`
- Risk:
  - Misconfiguration or misunderstood deployment mode can weaken moderation access control.

5) Chat workspace permission enforcement is manifest-dependent

- Evidence:
  - enforcement gate by `manifestIncludesPermission`: `chat service.js:742`
  - missing/undeclared permission => allowed with membership only: `chat service.js:1030`
- Risk:
  - Incomplete RBAC manifest can silently reduce enforcement from permission-based to membership-only.

6) Chat inbox filtering path does not explicitly call membership permission gate

- Evidence:
  - `listInbox` filters by scope and active workspace id, and assumes valid participant rows from repository result: `chat service.js:1678+`
- Risk (inference):
  - If participant status data were stale or inconsistent, thread list visibility could diverge from stricter `resolveThreadAccess` behavior used on thread operations.

## Subtle behavior worth preserving in future refactors

- `workspacePolicy: none` + empty route permission means auth plugin skips workspace context resolution (`request.workspace` remains null).
  - `plugin.js:208`
  - This is intentional for chat route style.
- `workspacePolicy: optional` still resolves context.
  - Billing benefits from this because service/action can use `request.workspace` and permissions when user selects workspace.
- Route surface and action surface are separate checks:
  - route-level surface only influences context resolver behavior
  - action runtime still enforces action `surfaces` list
  - `pipeline.js:105`
- Billing checkout has duplicate write-policy enforcement in orchestrator even though service delegates, which is good defense in depth.
  - `service.js:4248`, `checkoutOrchestrator.service.js:1641`

## Practical “if I touch this next” checklist

If adding/changing billing routes:

- Decide explicitly whether route `permission` should stay absent.
- If absent, ensure action/service policy checks are still unavoidable.
- Verify selector behavior (`x-workspace-slug`, `x-billable-entity-id`) and user fallback are intended.

If adding/changing social routes/actions:

- Keep route `permission` metadata for workspace endpoints unless intentionally moving RBAC into actions/services.
- If adding internal action usage, consider whether `social.read/write` RBAC should be checked beyond route layer.
- Re-check moderation config behavior (`permission` vs `operator`).

If adding/changing chat logic:

- Keep `resolveThreadAccess` as required gate for any thread-bound operation.
- Confirm manifest contains `chat.read`/`chat.write` if strict permission enforcement is expected.
- Re-check inbox/list paths for consistency with strict access semantics.

## Direct key references list

- Auth metadata model:
  - `packages/auth/fastify-auth-policy/src/shared/routeMeta.js:13`
- Auth prehandler and permission check:
  - `packages/auth/fastify-auth-policy/src/shared/plugin.js:208`
  - `packages/auth/fastify-auth-policy/src/shared/plugin.js:220`
- Route registration policy merge:
  - `apps/jskit-value-app/server/fastify/registerApiRoutes.js:19`
- App auth context resolver:
  - `apps/jskit-value-app/server/fastify/auth.plugin.js:80`
- Action execution context:
  - `apps/jskit-value-app/server/runtime/actions/buildExecutionContext.js:78`
- Action permission evaluator path:
  - `packages/runtime/action-runtime-core/src/shared/pipeline.js:109`
  - `packages/runtime/action-runtime-core/src/shared/policies.js:27`
- Billing routes no permission:
  - `packages/billing/billing-fastify-routes/src/shared/routes.js:10`
  - `apps/jskit-value-app/tests/billingRoutesPolicy.test.js:69`
- Billing action permission helper:
  - `packages/billing/billing-service-core/src/shared/actions/workspaceBilling.contributor.js:85`
- Billing write policy enforcement:
  - `packages/billing/billing-service-core/src/shared/policy.service.js:276`
  - `packages/billing/billing-service-core/src/shared/policy.service.js:327`
- Social route permissions:
  - `packages/social/social-fastify-routes/src/shared/routes.js:40`
  - `packages/social/social-fastify-routes/src/shared/routes.js:287`
- Social actions permission style:
  - `packages/social/social-core/src/shared/actions/social.contributor.js:95`
  - `packages/social/social-core/src/shared/actions/social.contributor.js:44`
  - `packages/social/social-core/src/shared/actions/social.contributor.js:575`
- Chat action auth-only permissions:
  - `packages/chat/chat-core/src/shared/actions/chat.contributor.js:104`
- Chat service membership/permission/thread checks:
  - `packages/chat/chat-core/src/shared/service.js:742`
  - `packages/chat/chat-core/src/shared/service.js:1021`
  - `packages/chat/chat-core/src/shared/service.js:1044`
  - `packages/chat/chat-core/src/shared/service.js:1417`
  - `packages/chat/chat-core/src/shared/service.js:1678`
- Workspace request context and service:
  - `packages/workspace/workspace-service-core/src/shared/lookups/workspaceRequestContext.js:34`
  - `packages/workspace/workspace-service-core/src/shared/services/workspace.service.js:766`
  - `packages/workspace/workspace-service-core/src/shared/services/workspace.service.js:793`
- Console context resolver:
  - `packages/workspace/workspace-console-service-core/src/shared/services/consoleAccess.service.js:126`

## Final distilled model

- Billing: no route permission metadata, enforced in action + billing policy service.
- Social: strong route metadata permission checks for workspace APIs, lighter action/service RBAC-string enforcement.
- Chat: route/action are mostly auth-only; real authorization is in chat service with membership + optional manifest-backed permission checks.
- Workspace context population is central and policy-driven, but only runs when route metadata requests it (`workspacePolicy != none` or route `permission` set).

# Frontend Permission Gating Deep-Dive (Context Dump)

This document is a maximal-detail dump of my current understanding from the files already inspected in `apps/jskit-value-app/src` and closely related shared/contracts files. It focuses on how the frontend derives permissions, applies them in routing/shells/views/realtime, and where it assumes server-side enforcement.

## 1. Core model: where permissions come from

### Workspace-side source of truth in client state
- `workspaceStore` is the primary workspace permission container.
- State contains:
  - `permissions: []`
  - `membership`
  - `activeWorkspace`
  - `app.features` flags and policy values
- `applyBootstrap(payload)` populates:
  - `permissions` from `payload.permissions`
  - `membership` from `payload.membership`
  - `activeWorkspace` from `payload.activeWorkspace`
  - app feature flags from `payload.app.features`:
    - `assistantEnabled`
    - `assistantRequiredPermission`
    - `socialEnabled`
    - other feature toggles
- `applyWorkspaceSelection(payload)` updates:
  - `activeWorkspace`
  - `membership`
  - `permissions`
  - `workspaceSettings`
- The key permission predicate is:
  - `workspaceStore.can(permission)`
  - returns `true` for empty permission string
  - otherwise checks `permissions.includes('*') || permissions.includes(permission)`

Implication:
- Workspace permission checks are simple client-side string membership checks over the latest bootstrap/selection snapshot.

### Console-side source of truth in client state
- `consoleStore` is the console permission container.
- State contains:
  - `membership`
  - `permissions`
  - `pendingInvites`
  - `roleCatalog`
- `applyBootstrap(payload)` populates those from API.
- `hasAccess` is derived only from membership status:
  - true iff `membership.status === 'active'`
- `setForbidden()` explicitly clears membership/permissions but sets `initialized=true`.
- `consoleStore.can(permission)` has same semantics as workspace (`*` wildcard, empty string true).

Implication:
- Console route/nav/action checks combine `hasAccess` + `consoleStore.can(...)`.

### Auth coupling
- `authStore` holds authenticated state/session bootstrap.
- Unauthorized handling pattern in many views:
  - `useAuthGuard().handleUnauthorizedError(error)`
  - only special-cases `401` -> sign out + clear stores + navigate to login
- `403` handling is not globally centralized in auth guard; it is handled per feature/guard in selective places.

## 2. Bootstrap and lifecycle by surface

`app/bootstrap/runtime.js` does surface-specific bootstrap before mounting router.

### Console surface bootstrap path
- Calls `api.auth.session()` first, applies auth session.
- Clears workspace state.
- If authenticated, calls `consoleStore.refreshBootstrap()`.
- On console bootstrap `403`:
  - calls `consoleStore.setForbidden()`.
- On `401`:
  - signs out and clears both workspace + console stores.

### App/Admin surface bootstrap path
- Calls `api.workspace.bootstrap()`.
- Applies auth session from bootstrap payload and `workspaceStore.applyBootstrap(...)`.
- Clears console state.

Implication:
- On app/admin surfaces, permission basis is workspace bootstrap.
- On console surface, permission basis is console bootstrap and may settle into forbidden mode without full signout.

## 3. Router guard architecture

There are two guard systems:
- Workspace/app/admin guards in `app/router/guards.js`.
- Console guards in `app/router/guards.console.js`.

### 3.1 Workspace/app/admin guard flow (`guards.js`)

#### Runtime resolution
- `resolveRuntimeState({authStore, workspaceStore})`:
  - if not initialized: calls `api.workspace.bootstrap()`, applies auth + workspace bootstrap
  - on `503`: marks `sessionUnavailable=true`
  - on other errors: signs out workspace context (`authStore.setSignedOut()`, `workspaceStore.clearWorkspaceState()`)

#### Base guard categories
- `beforeLoadRoot`: redirects authenticated users to workspace home or workspaces; unauthenticated -> login.
- `beforeLoadPublic`: keeps unauthenticated users on public routes; authenticated users redirected away.
- `beforeLoadAuthenticatedNoWorkspace`: requires auth and no active workspace.
- `beforeLoadAuthenticated`: requires auth only.
- `beforeLoadWorkspaceRequired`: requires auth + active workspace, and handles `$workspaceSlug` mismatch by attempting `workspaceStore.selectWorkspace(routeSlug)`.

#### Permission guard
- `beforeLoadWorkspacePermissionsRequired(context, requiredPermissions)`:
  - first runs workspace-required guard
  - checks `hasAnyWorkspacePermission(requiredPermissions)`
  - semantics are **any-of** permission list
  - empty required list -> allowed
  - fail -> redirect to workspace home or workspaces

#### Feature-policy guards
- Guard policies are composed from module registry (`composeGuardPolicies()`):
  - assistant policy keys (`featureFlag`, `requiredFeaturePermissionKey`)
  - social policy keys
- `beforeLoadAssistant`:
  - requires workspace context first
  - requires `assistantEnabled`
  - if `assistantRequiredPermission` is set, requires that permission
- `beforeLoadSocial`:
  - requires `social.read`
  - requires `socialEnabled`

### 3.2 Console guard flow (`guards.console.js`)

#### Runtime resolution
- `resolveConsoleRuntimeState({authStore, workspaceStore, consoleStore})`:
  - ensures auth session via `authStore.ensureSession()`
  - if unauthenticated: clears console state, returns no access
  - if authenticated and console not initialized: `consoleStore.refreshBootstrap()`
  - on console bootstrap `403`: `consoleStore.setForbidden()`
  - on `401`: signout + clear workspace + clear console

#### Base behavior
- `beforeLoadRoot`:
  - if authenticated + console access: allow
  - else if pending invites: redirect `/invitations`
  - else redirect fallback (app root)
- `beforeLoadPublic`: authenticated users are pushed to root/invitations/fallback.
- `beforeLoadInvitations`: requires auth, denies if already has console access, allows only with pending invites.
- `beforeLoadAuthenticated`: requires auth.

#### Route-specific permission guards
- `beforeLoadMembers`: requires `console.members.view`.
- `beforeLoadBrowserErrors`: requires `console.errors.browser.read`.
- `beforeLoadServerErrors`: requires `console.errors.server.read`.
- `beforeLoadAiTranscripts`: requires `console.ai.transcripts.read_all`.
- `beforeLoadBillingEvents`: requires `console.billing.events.read_all`.
- `beforeLoadBillingPlans`: requires `console.billing.catalog.manage`.
- `beforeLoadBillingPurchases`: requires `console.billing.operations.manage`.
- Entitlements/plan-assignments/subscriptions reuse plans/purchases guards.

## 4. Route-level permission mapping

### Workspace/admin route definitions
- `workspaceRoutes.js`
  - `/settings` requires any of:
    - `workspace.settings.view`
    - `workspace.settings.update`
  - `/admin` and `/admin/monitoring` require any of:
    - `workspace.billing.manage`
    - `workspace.ai.transcripts.read`
  - `/admin/billing` and `/billing` require:
    - `workspace.billing.manage`
  - `/admin/members` requires any of:
    - `workspace.members.view`
    - `workspace.members.invite`
    - `workspace.members.manage`
    - `workspace.invites.revoke`
  - `/admin/monitoring/transcripts` and `/transcripts` require:
    - `workspace.ai.transcripts.read`

### Projects routes
- `projectsRoutes.js`
  - list/view require `projects.read`
  - add/edit require `projects.write`

### Chat route
- `chatRoutes.js`
  - requires `chat.read`
  - if mounted outside admin surface, it redirects to equivalent admin workspace chat path

### Social routes
- `socialRoutes.js`
  - feed route uses `beforeLoadSocial` (social.read + socialEnabled)
  - moderation route (if included) requires `social.moderate`

### Assistant route
- `assistantRoutes.js`
  - uses `beforeLoadAssistant` (assistant feature policy + optional required permission)

### Console core routes
- `consoleCoreRoutes.js` wires all console-specific guard methods above.

### Filesystem-contributed routes
- `filesystemRoutes.js` resolves guard from route meta:
  - if `routeMeta.auth.guard` is explicit, uses that named guard
  - else default workspace-required for app/admin
  - supports `auth.requiredAnyPermission` -> `beforeLoadWorkspacePermissionsRequired`
- So filesystem routes can participate in same permission model if metadata is set.

## 5. Shell-level gating and navigation filtering

Shell composables are major visibility gates for nav/actions.

### 5.1 App shell (`useAppShell.js` + `AppShell.vue`)

#### Navigation filtering
- Navigation items come from `composeNavigationFragments('app')`.
- Each fragment is shown only if `isNavigationFragmentVisible(fragment)`:
  - if fragment has `featureFlag`, corresponding `workspaceStore.app.features[flag]` must be true
  - if fragment has `requiredFeaturePermissionKey`, it resolves actual permission string from `app.features[key]` and requires `workspaceStore.can(...)`
  - if fragment has `requiredAnyPermission`, requires any permission via helper

#### Admin surface entry gate
- `canOpenAdminSurface` requires:
  - active workspace membership role present
  - and workspace settings permission (`workspace.settings.view || workspace.settings.update`)
- `Go to Admin` menu item shown only if `canOpenAdminSurface`.

### 5.2 Admin shell (`useAdminShell.js` + `AdminShell.vue`)

#### Navigation filtering
- Same fragment filtering strategy as app shell, but on `composeNavigationFragments('admin')`.

#### Workspace control menu gate
- Computes booleans:
  - `canViewWorkspaceSettings`
  - `canViewAiTranscripts`
  - `canViewBilling`
  - `canViewMembersAdmin` (any of member perms)
  - `canViewMonitoring = transcripts || billing`
  - `canOpenWorkspaceControlMenu` if any of above menu areas is accessible
- Menu appears only when `canOpenWorkspaceControlMenu`; entries are disabled if missing specific perms.
- Handler methods also no-op early-return if missing perms.

### 5.3 Console shell (`useConsoleShell.js` + `ConsoleShell.vue`)

- Computes permission booleans as `consoleStore.can(...) && consoleStore.hasAccess` for each section.
- Navigation sections only include items if relevant boolean is true.
- Distinct nav groupings: members, AI, errors, billing config, billing reports.

### 5.4 Shell compositional source
- Navigation fragments originate from module registry + optional filesystem shell entries:
  - `composeNavigation.js` + `filesystemContributions.js`.
- Fragments carry permission and feature metadata:
  - `requiredAnyPermission`
  - `featureFlag`
  - `requiredFeaturePermissionKey`
- Mount paths are resolved via route mount registry (`routeMountRegistry.js`, `composeRouteMounts.js`).

## 6. View-level permission gating patterns

### Pattern A: route guard first, then optional in-view checks
Some screens rely almost entirely on route guards for access, then just execute queries/actions.
Examples:
- Projects views (`useProjectsList/Add/View/Edit`) do not add explicit local permission predicates; they rely on guarded routes and server responses.
- Workspace billing (`useWorkspaceBillingView`) similarly has no direct permission computed in view logic.
- Assistant/chat wrappers are thin and rely on route/runtime/server.

### Pattern B: in-view permission booleans + disabled UI + no-op action methods
Examples:
- Workspace settings/members:
  - Computes `canView*`/`canManage*` booleans from `workspaceStore.can`.
  - Query `enabled` tied to relevant permission.
  - Mutating action methods early-return when lacking permission.
  - Form controls set to `readonly`/`disabled` based on permission.
- Console home/members:
  - Same pattern with console permissions.

### Pattern C: conditional rendering + message for missing permission
- Monitoring view:
  - AI transcript tab disabled if no permission.
  - Shows info alert when transcript tab lacks permission.
  - Redirects from monitoring root to audit tab when transcript permission absent.

### Pattern D: feature action-level checks
- Social feed:
  - `canWrite`, `canModerate`, `canUseChat` from workspace permissions.
  - DM start explicitly checks chat permissions and actor locality.
  - Missing permission sets human-readable action error message.

## 7. Realtime permission gating and its limits

Realtime permission gating is multi-step:

### 7.1 Topic catalogs and permission requirements
- Shared topic rules from contracts (`packages/contracts/realtime-contracts/src/shared/appTopics.js`) define:
  - topic scope (`user` or `workspace`)
  - allowed surfaces
  - required permission arrays
  - optional surface-specific permission overrides

### 7.2 Runtime eligibility filter
- In `platform/realtime/realtimeRuntime.js`:
  - topic contributions composed from module registry (`composeRealtimeTopicContributions`).
  - eligible topics filtered by:
    - `isTopicAllowedForSurface(topic, surface)`
    - `hasAnyTopicPermission({ workspaceStore, topic, surface })`
      - currently uses `workspaceStore.can(...)`
  - runtime only connects if authenticated and there is at least one eligible topic and either:
    - workspace slug exists, or
    - at least one user-scoped topic exists

### 7.3 On-subscribe reconciliation and event processing
- `realtimeEventHandlers` maps topic -> invalidation strategy from composed invalidation definitions.
- Topic strategy can additionally trigger `workspaceStore.refreshBootstrap()` and/or `consoleStore.refreshBootstrap()`.
- Event bus publishes normalized events to local subscribers.

### 7.4 UI health representation
- Connection states are reflected in `realtimeStore` (`live`, `connecting`, `retrying`, `blocked`, `offline`, `idle`) and displayed as chips in shells.

### Important limitation/assumption
- Realtime permission filtering uses `workspaceStore.can`, not `consoleStore.can`.
- In current topic catalog, console topics are user-scoped and mostly have empty `requiredAnyPermission`, so they pass client filter by default when authenticated.
- Therefore, backend realtime subscription auth is critical to enforce actual access boundaries.

## 8. Handling missing permissions: practical outcomes

### Redirect-based denial
- Most guard failures redirect to a safer route:
  - workspace home
  - workspace list
  - console invitations
  - app fallback root

### Visibility denial
- Nav entries are hidden when permission/feature requirements fail.

### Interaction denial
- Buttons/fields become disabled or read-only.
- Action functions early-return before calling APIs.

### Query denial
- Vue Query `enabled` is often bound to permission booleans, so unauthorized data queries are never attempted client-side for those views.

### Error-path behavior
- `401` usually triggers full sign-out and login redirect via auth guard helper.
- `403` behavior is mixed:
  - console bootstrap has explicit forbidden handling (`setForbidden`)
  - many other areas surface API error messages without central forbidden UX

## 9. Module-driven composition details that affect permissions

The app is heavily module-composed (`moduleRegistry.base.js`, `composeRouter.js`, `composeNavigation.js`, `composeGuards.js`, `composeRealtimeClient.js`).

### Guard policy injection
- Assistant and social feature policy keys come from module registry guard policies, not hardcoded only in guard functions.

### Navigation permission metadata
- Module navigation fragments define required permissions and feature flags.
- Example from registry:
  - chat nav requires `chat.read`
  - social nav requires `social.read` + `socialEnabled`
  - social moderation nav requires `social.moderate` + `socialEnabled`
  - assistant nav uses feature flag + required feature permission key

### Route fragment composition
- Routes for assistant/chat/social/projects/workspace are injected as fragments by module registry.
- Guard behavior is consistent because route fragments call shared guard methods.

### Extension points
- Client extensions loaded from `app/extensions.d/*.client.js` can add route fragments/navigation/guard policies/realtime contributions.
- Current inspected extension stubs are essentially empty (`10-projects.client.js`, `20-realtime.client.js`).

## 10. Client-only assumptions and server enforcement requirements

These are the most crucial trust boundaries:

1) Permission arrays are trusted snapshots.
- `can()` uses local arrays only.
- Any stale/tampered client state must be harmless because server must re-enforce authorization.

2) Hidden/disabled UI is not security.
- Users can still forge requests; backend must reject unauthorized API operations.

3) Route guards are not security.
- Guards prevent normal navigation only. Backend still must enforce permissions on all endpoints.

4) Realtime client filtering is advisory.
- Subscription eligibility filtered on client must be mirrored/enforced on server handshake/topic authorization.

5) Mixed 403 handling means UX, not auth consistency.
- Some flows explicitly model forbidden state; others just show errors.
- Security still depends on backend response correctness.

6) Filesystem extension routes/nav can add auth metadata.
- If extension metadata is missing/misconfigured, client may expose links/pages incorrectly; server must still deny unauthorized access.

## 11. Notable implementation nuances / possible footguns

1) `can(permission)` returns true for empty permission string.
- Safe if callers normalize correctly.
- Dangerous if accidental empty permission is treated as protected.

2) `hasAnyWorkspacePermission` helper differs across files.
- In guards, supports string-or-array robustly.
- In app/admin shell helpers, non-array input collapses to empty list => true.
- If a navigation fragment accidentally sets `requiredAnyPermission` as string (not array), shell filtering could become permissive.

3) Console access is membership-status driven.
- Permission checks in console shell include `hasAccess`; in some views they use `consoleStore.can` directly and depend on route guard context.

4) `sessionUnavailable (503)` path in guards.
- Guards can return without redirecting on 503 to allow degraded UX rather than hard bounce.

5) Chat route forces admin surface.
- Non-admin chat route access redirects to admin equivalent after permission check.

6) Monitoring tab fallback logic is explicit.
- No transcript permission auto-switches user from monitoring root to audit tab.

## 12. Condensed permission matrix (high-level)

### Workspace/admin
- Settings page: `workspace.settings.view` OR `workspace.settings.update`
- Billing pages: `workspace.billing.manage`
- Transcripts pages: `workspace.ai.transcripts.read`
- Members admin: any of `workspace.members.view|invite|manage|workspace.invites.revoke`
- Social feed: `social.read` + `socialEnabled`
- Social moderation: `social.moderate`
- Assistant: `assistantEnabled` + optional `assistantRequiredPermission`
- Projects list/view: `projects.read`
- Projects add/edit: `projects.write`
- Chat route: `chat.read`

### Console
- Members: `console.members.view`
- Browser errors: `console.errors.browser.read`
- Server errors: `console.errors.server.read`
- AI transcripts: `console.ai.transcripts.read_all`
- Billing events: `console.billing.events.read_all`
- Billing plans/products/entitlements: `console.billing.catalog.manage`
- Purchases/plan assignments/subscriptions: `console.billing.operations.manage`
- Console home setting mutation: `console.assistant.settings.manage`

## 13. End-to-end control flow summary

1) Bootstrap establishes auth + workspace/console permissions in stores.
2) Router guards gate route entry by auth/workspace/console-access/permissions/features.
3) Shells build/hide nav and workspace-control affordances using store permissions + feature flags.
4) Views optionally apply additional local checks:
- query enablement
- disabled fields/buttons
- early-return action handlers
- user-facing “no permission” messages in select places
5) Realtime runtime subscribes only to client-eligible topics (surface + permission filtering), then invalidates queries / refreshes bootstrap on events.
6) Backend remains final authority for API and realtime authorization.

## 14. Practical security posture interpretation

- The frontend permission model is coherent and layered, and mostly defensive from UX perspective.
- It is intentionally not authoritative.
- Correctness and security hinge on backend enforcement of:
  - every API endpoint permission rule
  - workspace/console context scoping
  - realtime subscription authorization per topic/surface/context
- If backend enforcement is strong, frontend behavior is acceptable and user-friendly.
- If backend enforcement is weak, hidden buttons and route redirects do not provide security.

## 15. Backend Enforcement Context (Relevant To Frontend Gating)

This section summarizes backend enforcement (from other AGENT docs) that directly affects or constrains frontend permission gating.

### 15.1 Common enforcement pipeline
- Route metadata defaults to `auth: public`, `workspacePolicy: none`, and empty permission unless explicitly set.
- Auth prehandler enforces:
  - authentication when `auth` requires
  - context resolution when `workspacePolicy != none` or route `permission` exists
  - route `permission` only if route meta declares it
- Controllers execute actions through the action runtime with `channel: api`.
- Action runtime enforces:
  - allowed channels
  - allowed surfaces
  - visibility
  - permission policy (function or array)
- Services then apply domain checks and constraints.

Frontend implication:
- UI gating is advisory; real authorization is enforced server-side in multiple layers.

### 15.2 Workspace service access rules
- Workspace access is surface-dependent:
  - app surface enforces deny-lists (user ids, emails)
  - admin surface does not apply deny-lists
- Surface resolution precedence in backend context:
  - explicit route `workspaceSurface`
  - `x-surface-id` header
  - pathname-derived surface
- Workspace selection precedence:
  - `x-workspace-slug` header
  - query `workspaceSlug`
  - route param `workspaceSlug`
- `workspacePolicy: required` with no selection returns `409`.

Frontend implication:
- If route metadata does not pin surface, header/path resolution can change access outcomes.

### 15.3 Workspace route vs action mismatch
- Backend GET admin workspace settings route requires `workspace.settings.view`.
- Backend action allows `workspace.settings.view OR workspace.settings.update`.
- Frontend uses view OR update to render settings views and enable routing.

Frontend implication:
- If a role has update permission without view, UI will show settings but backend route rejects. This is a real mismatch to resolve if such a role exists.

### 15.4 Console backend model highlights
- Console role catalog:
  - `console` role is non-assignable and has `*`.
  - `devop` role includes errors read, billing events/catalog/ops, assistant settings manage, and transcripts read/export.
  - `moderator` role includes only `console.content.moderate`.
- Console context resolution auto-seeds first active console member:
  - first authenticated console request when no active members promotes that user to `console` + root.
- Console routes generally lack route-level permission metadata; enforcement is in action and service layers.
- Browser error ingestion is intentionally public (auth: public, CSRF off) with rate limits.

Frontend implication:
- Most console UI permissions only light up for `console` or `devop` roles.
- UI hides console member management for non-console roles because `console.members.*` are not in devop.
- Console surface state can transition to “forbidden” (403) instead of full signout.

### 15.5 Billing backend enforcement model
- Billing API routes are authenticated but do not declare route permissions.
- Action-level permission helper allows operations when:
  - no workspace selected, or
  - workspace selected and `workspace.billing.manage` exists
- Billing policy service performs primary write enforcement:
  - workspace selected -> requires `workspace.billing.manage`
  - no selectors -> falls back to user billable entity

Frontend implication:
- Frontend admin billing pages are strictly gated by `workspace.billing.manage`.
- Backend billing API may still allow user-scoped operations without workspace selection. This can be more permissive than frontend UI in some flows.

### 15.6 Social backend enforcement model
- Social routes declare explicit route permission metadata for workspace APIs (`social.read`, `social.write`, `social.moderate`).
- Social actions mostly enforce authenticated + workspace context, not explicit RBAC strings.
- Social service validates auth/workspace presence, but not explicit `social.read/write` permission strings.
- Moderation permissions can be bypassed in `moderationAccessMode === "operator"`.

Frontend implication:
- Frontend gating matches route-level RBAC for public API usage.
- Internal action usage could bypass RBAC string checks if route policy is bypassed.

### 15.7 Chat backend enforcement model
- Chat routes: auth required, `workspacePolicy: none`, no route permission metadata.
- Chat actions: auth-only permission.
- Chat service enforces membership + `chat.read`/`chat.write` when permissions are defined in manifest; otherwise membership-only.
- Thread access checks are central and used for read/write operations.

Frontend implication:
- Frontend requires `chat.read` for route access, which is stricter than backend if manifest omits chat permissions.
- If manifest missing chat perms, backend may allow more than frontend shows.

## 16. Cross-Layer Alignment Summary (Frontend vs Backend)

### Consistent alignments
- Workspace admin routing in frontend matches backend RBAC strings for most pages.
- Console UI gating uses the same permission IDs as backend actions and services.
- Social feed UI gating (`social.read/write/moderate`) matches backend route metadata permissions.

### Notable mismatches / divergences
- Workspace settings read permission mismatch (frontend allows view OR update; backend route requires view).
- Billing API more permissive for user-scoped operations vs frontend strictly requiring `workspace.billing.manage` for admin billing screens.
- Chat frontend requires `chat.read` but backend can be membership-only if manifest lacks permissions.
- Console realtime topic filtering is client-side only and does not check console permissions; backend must enforce subscription authorization.

## 17. Console Role Catalog Map (Practical UI Effect)

- `console` role:
  - Has `*`, so all console UI sections are visible and actionable.
- `devop` role:
  - Can access errors, billing, assistant settings, AI transcripts.
  - Cannot access members/invites/roles because `console.members.*` and `console.roles.view` are not included.
- `moderator` role:
  - Only `console.content.moderate`, which is not used by current console UI routes; expect minimal UI access.

## 18. Additional Permission-Affecting Behaviors

- App-surface deny lists are enforced server-side only for app surface; admin surface bypasses them.
- Workspace settings deny lists are included in backend settings payload only for callers with `workspace.settings.update`.
- Console root identity and role immutability are enforced in backend services and DB constraints.
- Console invite tokens are redeemable by matching email even when represented as hashed tokens; token leakage risk exists.

## 19. Practical Implications for Frontend Changes

- If frontend introduces new admin settings roles that only have update permission (no view), backend route permission must be adjusted to avoid 403 mismatches.
- If frontend expects chat permission enforcement, ensure RBAC manifest includes `chat.read` and `chat.write` so backend service enforces.
- If frontend adds new console UI sections for member management, ensure role catalog includes `console.members.*` for non-console roles or expect those sections to remain hidden.
- For any new filesystem routes, ensure `routeMeta.auth.requiredAnyPermission` is set; otherwise, `beforeLoadWorkspaceRequired` may allow access without specific permissions.

## 20. RBAC Manifest: Role -> Permission Map (Source of UI Permission Strings)

Source: [rbac.manifest.json](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/shared/rbac.manifest.json)

The shared RBAC manifest defines the canonical role-to-permission mapping. This is the likely source of the permissions list returned by backend endpoints and stored in `workspaceStore.permissions` on the client. It also explains why `workspaceStore.can("...")` expects string keys like `workspace.settings.update` or `chat.read`.

Roles:
- `owner`: `*` (all permissions, including future ones)
- `admin`: explicitly enumerated permissions
- `member`: subset of admin
- `viewer`: read-only subset

Admin permissions include:
- Workspace and membership: `workspace.members.view`, `workspace.members.manage`, `workspace.invites.view`, `workspace.invites.invite`, `workspace.invites.revoke`
- Workspace settings and roles: `workspace.settings.view`, `workspace.settings.update`, `workspace.roles.view`
- AI transcripts: `workspace.ai.transcripts.read`, `workspace.ai.transcripts.export`
- Billing: `billing.manage`
- Product areas: `history.read`, `history.write`, `chat.read`, `chat.write`, `projects.read`, `projects.write`, `social.read`, `social.write`, `social.moderate`

Member permissions:
- `history.read`, `history.write`
- `chat.read`, `chat.write`
- `projects.read`, `projects.write`
- `social.read`, `social.write`

Viewer permissions:
- `history.read`
- `projects.read`
- `social.read`

How this impacts frontend gating:
- `workspaceStore.can("chat.read")`/`can("chat.write")` aligns with manifest.
- `workspaceStore.can("workspace.settings.update")` and `can("workspace.members.manage")` for admin UI aligns with manifest.
- `workspaceStore.can("billing.manage")` maps to billing gating seen in admin/billing UI.
- `workspaceStore.can("workspace.ai.transcripts.read")` and `can("workspace.ai.transcripts.export")` used in transcript flows.

Client-only assumption risk:
- The UI assumes `workspaceStore.permissions` is already filtered by backend to match this manifest; if backend returns unrecognized strings or `*`, client-side `can()` must interpret them correctly. There is no frontend evidence of `*` handling in the code I reviewed, so if the owner permission is expressed as `*` (not expanded to individual strings), frontend `can()` must account for it or owner would be incorrectly gated. I did not see that code in the original frontend doc (not in the files read), so this is an assumption to validate in the store implementation.

## 21. Backend Workspace Admin Routes Mirror UI Gating

Source: [admin.routes.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/workspace/routes/admin.routes.js)

Backend admin routes are explicitly tagged with permission requirements, matching the frontend gating strings:
- `workspace.settings.view` / `workspace.settings.update` for workspace settings
- `workspace.roles.view` for roles list
- `workspace.ai.transcripts.read` / `workspace.ai.transcripts.export` for transcript APIs
- `workspace.members.view` / `workspace.members.manage` for members list / changes
- `workspace.invites.view`, `workspace.invites.invite`, `workspace.invites.revoke`

This provides server-side confirmation for frontend’s `can()` checks and clarifies that missing frontend gating would still be enforced on the API layer.

## 22. App Runtime Policy + Bootstrap Schema: Feature Flags Used by Frontend

Sources:
- [bootstrap.schema.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/workspace/schemas/bootstrap.schema.js)
- [appRuntimePolicy.js](/home/merc/Development/current/jskit-ai/packages/runtime/runtime-env-core/src/shared/appRuntimePolicy.js)

Bootstrap response contains `app.features`, which include:
- `assistantEnabled`, `assistantRequiredPermission`
- `socialEnabled`, `socialFederationEnabled`
- other app-level flags (ai/images/providers/assistant/chat/social configs)

`appRuntimePolicy` derives these features from repository config:
- `assistantEnabled`/`assistantRequiredPermission` from `repo.config.ai.*`
- `socialEnabled`/`socialFederationEnabled` from `repo.config.social.*`
- `toBrowserConfig()` includes these features for client consumption

Frontend gating ties into this in two ways:
- Features control whether entire modules are shown (e.g., assistant or social surfaces)
- Permission checks (e.g., `assistantRequiredPermission`) add an extra gate on top of normal read/write perms

Client-only assumption risk:
- If frontend assumes `assistantEnabled` or `socialEnabled` alone is enough to show UI, it could still receive permission-based 403s if required perms are missing (the server enforces them; see section 23).

## 23. Assistant Server Actions Enforce Required Permission

Source: [assistant.contributor.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/assistant.contributor.js)

Server action policy for assistant requests includes:
- Must be authenticated
- `ctx.repo.config.ai.action.enabled` must be true
- If `ctx.repo.config.ai.assistantRequiredPermission` is set, user must have that permission (checked via `hasPermission`)

Additional server-side enforcement:
- When using assistant admin endpoints, the server checks `workspace.ai.transcripts.read` for transcript access.

This mirrors frontend behavior where the UI checks `assistantRequiredPermission` and permission strings before allowing assistant flows. The server independently enforces that requirement to prevent client bypass.

## 24. Client Chat Runtime Uses Workspace Permission

Source: [useChatRuntime.js](/home/merc/Development/current/jskit-ai/packages/chat/chat-client-runtime/src/shared/useChatRuntime.js)

Client chat runtime is enabled only when:
- The user is authenticated
- The workspace is active
- `workspaceStore.can("chat.read")` is true

This is a second layer of permission gating beyond UI components and router guards. It ensures that chat data queries and subscriptions won’t run for users lacking `chat.read`.

## 25. Realtime Server SocketIO Enforces Topic Permissions

Source: [registerRealtimeServerSocketio.js](/home/merc/Development/current/jskit-ai/packages/realtime/realtime-server-socketio/src/shared/registerRealtimeServerSocketio.js)

Realtime enforcement is server-side and not optional:
- Validates topic name and surface for every subscription and action
- For workspace topics:
  - Resolves workspace context from user + workspaceId
  - Loads workspace and member record
  - Injects member permissions into context for checks
- Applies `hasTopicPermission(topic, permissions, surface)`:
  - If 401/403/409 → denies and may evict socket from rooms
- Only joins rooms when topic permission passes

This confirms frontend realtime gating is advisory, but server is authoritative and will block unauthorized subscriptions regardless of client behavior.

## 26. Updated Frontend/Backend Alignment Summary

The newly read backend files confirm that frontend permission checks map to explicit backend enforcement points:
- RBAC manifest defines canonical permission strings used by both sides.
- Workspace admin routes and assistant actions validate those permissions on the server.
- App runtime policy ensures feature flags and required permissions are derived centrally and included in bootstrap.
- Realtime server validates topic permissions regardless of client gating.

Remaining risks/assumptions on frontend:
- `owner` role using `*` requires `workspaceStore.can()` to interpret wildcard correctly. If not, owner would appear under-permissioned in UI. I did not locate that function in the frontend files I had read previously, so confirm it in the store implementation.
- Some client runtime gating (like chat) assumes `workspaceStore.permissions` is accurate and current; if permissions are stale (e.g., after role change), UI might still show features until bootstrap refresh or store update.

## 27. Workspace + Console Stores: Permission Normalization and Wildcards

Sources:
- [workspaceStore.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/state/workspaceStore.js#L142)
- [consoleStore.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/state/consoleStore.js#L83)

Workspace store:
- `applyBootstrap()` normalizes `payload.permissions` into `workspaceStore.permissions` (trimmed strings, blanks filtered). This is the primary source of UI permissions. [workspaceStore.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/state/workspaceStore.js#L189)
- `applyWorkspaceSelection()` updates permissions when switching workspaces (called by route guard when workspace slug changes). [workspaceStore.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/state/workspaceStore.js#L242)
- `can(permission)` returns `true` for blank permissions and honors the wildcard `"*"`. [workspaceStore.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/state/workspaceStore.js#L294)

Console store:
- `applyBootstrap()` normalizes `payload.permissions` into `consoleStore.permissions`. [consoleStore.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/state/consoleStore.js#L100)
- `hasAccess` is true only when membership status is `active`. [consoleStore.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/state/consoleStore.js#L92)
- `setForbidden()` clears membership and permissions but keeps `initialized = true`, so UI can render a “no access” state without assuming the store is empty. [consoleStore.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/state/consoleStore.js#L110)
- `can(permission)` returns `true` for blank permissions and honors `"*"`. [consoleStore.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/state/consoleStore.js#L123)

This resolves the earlier question: wildcard `"*"` is explicitly handled client-side in both stores.

## 28. App/Admin Route Guard Pipeline (Workspace Permissions)

Source: [guards.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/router/guards.js#L1)

Bootstrap and session resolution:
- `resolveRuntimeState()` fetches workspace bootstrap if auth/workspace store is not initialized, applies session and bootstrap, and handles 503 vs. other failures. 503 leads to a “sessionUnavailable” result; other errors sign the user out and clear workspace state. [guards.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/router/guards.js#L6)

Permission checks:
- `beforeLoadWorkspaceRequired()` enforces authentication + active workspace; if the route’s `workspaceSlug` differs from active workspace, it calls `workspaceStore.selectWorkspace()` which refreshes permissions for that workspace. [guards.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/router/guards.js#L139)
- `beforeLoadWorkspacePermissionsRequired()` delegates to `beforeLoadWorkspaceRequired()` then checks permissions with `workspaceStore.can()`; if missing, it redirects to the workspace home path or workspaces list. [guards.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/router/guards.js#L166)

Feature gating:
- `beforeLoadAssistant()` checks `assistantEnabled` and optionally `assistantRequiredPermission` from `workspaceStore.app.features`, and redirects if not allowed. [guards.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/router/guards.js#L194)
- `beforeLoadSocial()` first requires `social.read`, then checks `socialEnabled` feature flag. [guards.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/router/guards.js#L246)

Missing permission handling:
- For workspace-based routes, missing permissions lead to a redirect to workspace home or the workspaces page, not a hard error, which means the UI usually “lands somewhere safe” even if a user deep-links a forbidden view.

## 29. Console Route Guard Pipeline (Console Permissions)

Source: [guards.console.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/router/guards.console.js#L1)

Bootstrap and access resolution:
- `resolveConsoleRuntimeState()` ensures auth session, refreshes console bootstrap, handles 403 by calling `consoleStore.setForbidden()` (no access), and 401 by signing out and clearing stores. [guards.console.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/router/guards.console.js#L22)
- If `consoleStore` is missing, a stub store is used where `can()` is always false, avoiding accidental access. [guards.console.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/router/guards.console.js#L4)

Route-level permission gating:
- Each route has a specific guard (members, errors, transcripts, billing) that requires `hasConsoleAccess` and the relevant permission; otherwise it redirects to console root or invitations/fallback. [guards.console.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/router/guards.console.js#L197)

Missing permission handling:
- Missing permission leads to a redirect, not an error state. The user sees either the console root, the invitations page, or the app fallback.

## 30. Route Definitions That Enforce Permissions

Routes map directly to permission requirements via `beforeLoadWorkspacePermissionsRequired` or console guards:
- Workspace admin routes: settings, billing, members, monitoring, transcripts each require specific workspace permissions. [workspaceRoutes.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/router/routes/workspaceRoutes.js#L17)
- Projects: list/view require `projects.read`; add/edit require `projects.write`. [projectsRoutes.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/router/routes/projectsRoutes.js#L24)
- Chat: requires `chat.read`; if accessed from app surface, it redirects to admin surface. [chatRoutes.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/router/routes/chatRoutes.js#L28)
- Social: feed requires `social.read` (via `beforeLoadSocial`); moderation route requires `social.moderate`. [socialRoutes.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/router/routes/socialRoutes.js#L22)
- Assistant: gated by `beforeLoadAssistant`. [assistantRoutes.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/router/routes/assistantRoutes.js#L21)
- Core routes: login/public/auth/workspaces all delegate to guard methods for auth/workspace gating. [coreRoutes.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/router/routes/coreRoutes.js#L15)

## 31. Navigation Gating in Shells (UI Visibility)

App/Admin shells:
- Navigation items are built from composed fragments and filtered by `featureFlag`, `requiredFeaturePermissionKey`, and `requiredAnyPermission`. If a feature is disabled or a permission missing, the nav entry is hidden. [useAppShell.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/shells/app/useAppShell.js#L52), [useAdminShell.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/shells/admin/useAdminShell.js#L69)
- `canOpenAdminSurface` requires workspace membership plus `workspace.settings.view` or `workspace.settings.update`. [useAppShell.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/shells/app/useAppShell.js#L86)

Console shell:
- Console navigation items are shown only if `consoleStore.hasAccess` plus the relevant permission. [useConsoleShell.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/shells/console/useConsoleShell.js#L44)

This is UI-only gating: it controls what appears in menus, but doesn’t replace route guards or server enforcement.

## 32. Module Registry + Filesystem Contributions Drive Guard Policies and Nav Rules

Module registry:
- `moduleRegistry.base.js` defines guard policies and navigation fragments with `featureFlag` and `requiredAnyPermission`, which are then used by guards and shells. [moduleRegistry.base.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/framework/moduleRegistry.base.js#L36)
- Assistant guard policy uses `assistantEnabled` + `assistantRequiredPermission`. [moduleRegistry.base.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/framework/moduleRegistry.base.js#L64)
- Social guard policy uses `socialEnabled`. [moduleRegistry.base.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/framework/moduleRegistry.base.js#L422)
- Navigation entries for chat and social include `requiredAnyPermission`, driving shell visibility. [moduleRegistry.base.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/framework/moduleRegistry.base.js#L333)

Filesystem contributions:
- Filesystem routes can specify `routeMeta.auth.requiredAnyPermission`, which is translated into a permission-aware guard at route creation time. [filesystemRoutes.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/router/routes/filesystemRoutes.js#L33)
- Filesystem shell entries can carry `featureFlag`, `requiredFeaturePermissionKey`, and `requiredAnyPermission`, which become navigation fragments and are filtered by shell gating. [filesystemContributions.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/framework/filesystemContributions.js#L69)

## 33. Workspace Admin Views: Permission-Driven UI + Handling Missing Access

Workspace settings:
- `useWorkspaceSettingsView()` uses `canViewWorkspaceSettings` to enable queries and `canManageWorkspaceSettings` to allow mutations; actions return early if permission is missing. [useWorkspaceSettingsView.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/workspace-settings/useWorkspaceSettingsView.js#L110)
- On updates (settings or member roles), the store refreshes bootstrap to pull updated permissions. [useWorkspaceSettingsView.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/workspace-settings/useWorkspaceSettingsView.js#L340)
- The Vue SFC shows read-only UI when lacking update permission (fields disabled, “Read-only” chip). [WorkspaceSettingsView.vue](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/workspace-settings/WorkspaceSettingsView.vue#L16)

Workspace monitoring:
- The monitoring view hides transcripts unless `workspace.ai.transcripts.read` is granted, shows an informational alert instead, and redirects to the audit tab when transcripts aren’t allowed. [WorkspaceMonitoringView.vue](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/workspace-admin/WorkspaceMonitoringView.vue#L10)

Workspace members:
- Workspace members UI reuses `useWorkspaceSettingsView()` permissions to enable/disable member management actions. [WorkspaceMembersView.vue](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/workspace-admin/WorkspaceMembersView.vue#L16)

Client-only assumptions:
- `useWorkspaceBillingView()` does not check permissions; it assumes the route guard already enforced `workspace.billing.manage` and relies on server errors otherwise. [useWorkspaceBillingView.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/workspace-billing/useWorkspaceBillingView.js#L209)
- `useWorkspaceTranscriptsView()` does not check permissions; it relies on route guards/monitoring view to prevent access and will surface API errors if unauthorized. [useWorkspaceTranscriptsView.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/workspace-transcripts/useWorkspaceTranscriptsView.js#L77)

## 34. Console Views: Permission Flags and Read-Only UI

Console home:
- The settings query always runs, but mutations are blocked if `console.assistant.settings.manage` is missing, and the UI becomes read-only/disabled. [useConsoleHomeView.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/useConsoleHomeView.js#L21), [ConsoleHomeView.vue](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/ConsoleHomeView.vue#L15)
- If the API returns 401, `useAuthGuard` signs out; other errors are displayed to the user. [useConsoleHomeView.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/useConsoleHomeView.js#L51)

Console members:
- Queries for members/invites are only enabled when `console.members.view` is present. [useConsoleMembersView.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/useConsoleMembersView.js#L50)
- Invite/revoke/update actions return early when permission is missing, so UI controls can be rendered but will no-op if the user lacks access. [useConsoleMembersView.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/useConsoleMembersView.js#L182)

## 35. Social View Permission Handling

- `useSocialFeedView()` computes `canWrite`, `canModerate`, and `canUseChat` from workspace permissions. These are returned to the view for UI state. [useSocialFeedView.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/social/useSocialFeedView.js#L109)
- Direct messages are blocked client-side if `chat.read` and `chat.write` are missing, with an explicit error string. [useSocialFeedView.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/social/useSocialFeedView.js#L214)
- Moderation navigation returns early if `social.moderate` is missing. [useSocialFeedView.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/social/useSocialFeedView.js#L259)

## 36. Realtime Client Gating + Topic Permission Rules

Realtime client behavior:
- `realtimeRuntime` uses topic rules to compute required permissions per surface, filters eligible topics by `workspaceStore.can()`, and only connects if authenticated and at least one eligible topic exists (or if user-scoped topics allow connection without a workspace slug). [realtimeRuntime.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/platform/realtime/realtimeRuntime.js#L46)
- Topic permission checks are client-side advisory; server enforces them, but the client avoids subscribing to topics that fail permission or surface checks. [realtimeRuntime.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/platform/realtime/realtimeRuntime.js#L84)

Topic permissions map (app-specific rules):
- `history` requires `history.read` (app surface only). [appTopics.js](/home/merc/Development/current/jskit-ai/packages/contracts/realtime-contracts/src/shared/appTopics.js#L66)
- `projects` requires `projects.read` (app/admin). [appTopics.js](/home/merc/Development/current/jskit-ai/packages/contracts/realtime-contracts/src/shared/appTopics.js#L82)
- `workspace_settings` requires `workspace.settings.view` or `workspace.settings.update` (admin only). [appTopics.js](/home/merc/Development/current/jskit-ai/packages/contracts/realtime-contracts/src/shared/appTopics.js#L92)
- `workspace_members` and `workspace_invites` require `workspace.members.view` (admin only). [appTopics.js](/home/merc/Development/current/jskit-ai/packages/contracts/realtime-contracts/src/shared/appTopics.js#L97)
- `workspace_ai_transcripts` and `workspace_billing_limits` are surface-aware: admin requires `workspace.ai.transcripts.read` / `workspace.billing.manage`, app surface requires none. [appTopics.js](/home/merc/Development/current/jskit-ai/packages/contracts/realtime-contracts/src/shared/appTopics.js#L107)
- `chat` and `typing` require `chat.read` (app/admin). [appTopics.js](/home/merc/Development/current/jskit-ai/packages/contracts/realtime-contracts/src/shared/appTopics.js#L150)
- `social_feed` and `social_notifications` require `social.read` (app/admin). [appTopics.js](/home/merc/Development/current/jskit-ai/packages/contracts/realtime-contracts/src/shared/appTopics.js#L160)

Wildcard handling:
- Topic permission checks treat `"*"` as full access. [topicCatalog.js](/home/merc/Development/current/jskit-ai/packages/contracts/realtime-contracts/src/shared/topicCatalog.js#L163)

Realtime invalidation and permission refresh:
- Realtime event handlers can trigger `workspaceStore.refreshBootstrap()` or `consoleStore.refreshBootstrap()` for certain topics, helping permissions stay current after changes like member updates or settings changes. [realtimeEventHandlers.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/platform/realtime/realtimeEventHandlers.js#L264)

## 37. Router Composition: Where Guards and Permissions Are Wired In

- App/admin routers compose guard policies from modules, then pass them to `createSurfaceRouteGuards()`. [app.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/router/app.js#L6)
- `createSurfaceRouter()` builds core routes and adds module route fragments with the guard set, ensuring permission checks apply consistently. [factory.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/router/factory.js#L11)
- Console router wires its own guard set with per-route permission checks. [console.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/router/console.js#L8)

## 38. Updated Client-Only Assumptions (after deeper read)

Now that more frontend files are read, here are the concrete client-only assumptions that rely on server enforcement:
- `useWorkspaceBillingView()` and `useWorkspaceTranscriptsView()` do not gate API calls by permission; they assume route guards have already blocked entry and rely on server 403s otherwise. [useWorkspaceBillingView.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/workspace-billing/useWorkspaceBillingView.js#L209), [useWorkspaceTranscriptsView.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/workspace-transcripts/useWorkspaceTranscriptsView.js#L77)
- `useConsoleHomeView()` always queries console settings even if the user lacks manage permission; it depends on server enforcement and displays error messages on failure. [useConsoleHomeView.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/useConsoleHomeView.js#L23)
- Navigation gating (app/admin/console shells) is UI-only; deep-linking is prevented by route guards, not by the shell UI itself. [useAppShell.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/shells/app/useAppShell.js#L118), [useAdminShell.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/shells/admin/useAdminShell.js#L142), [useConsoleShell.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/shells/console/useConsoleShell.js#L63)
- The realtime client filters topics based on `workspaceStore.can()`, but server enforcement remains authoritative; a compromised client could request topics anyway. [realtimeRuntime.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/platform/realtime/realtimeRuntime.js#L84)

## 39. Server Surface Access Policy (App vs Admin)

Sources:
- [appSurface.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/surfaces/appSurface.js#L1)
- [adminSurface.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/surfaces/adminSurface.js#L1)
- [surfaces/index.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/surfaces/index.js#L1)

Server-side surface access is authoritative and more strict than frontend checks:
- App surface (`appSurface.js`) requires active membership and applies deny lists (user IDs + emails) from workspace settings. If a user is denied, access is rejected with reason `user_denied` or `email_denied`. [appSurface.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/surfaces/appSurface.js#L34)
- Admin surface (`adminSurface.js`) only requires active membership; no deny list logic is applied there. [adminSurface.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/surfaces/adminSurface.js#L1)
- `surfaces/index.js` selects the access policy per surface and defaults to deny for unsupported surfaces. [surfaces/index.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/surfaces/index.js#L1)

Client-only assumption:
- The frontend does not enforce deny lists; a user can appear in the UI but still be blocked server-side when app surface access rules deny them.

## 40. Fastify Auth Policy Resolves Permissions for Each Request

Sources:
- [auth.plugin.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/fastify/auth.plugin.js#L1)
- [registerApiRoutes.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/fastify/registerApiRoutes.js#L1)

Server enforcement flow:
- Auth policy plugin resolves surface from route metadata, `x-surface-id` header, or pathname. [auth.plugin.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/fastify/auth.plugin.js#L20)
- For console surface, it uses `consoleService.resolveRequestContext()` to populate membership + permissions. [auth.plugin.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/fastify/auth.plugin.js#L85)
- For non-console surfaces, it uses `workspaceService.resolveRequestContext()` to populate workspace/membership/permissions. [auth.plugin.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/fastify/auth.plugin.js#L102)
- Route registration merges `route.permission`, `route.workspacePolicy`, and other policy fields into auth enforcement. [registerApiRoutes.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/fastify/registerApiRoutes.js#L8)

Takeaway: even if UI gating is bypassed, route-level permission checks are enforced by the server via auth policy and action runtime permissions.

## 41. Workspace Permission Resolution (Server) Uses RBAC Manifest

Sources:
- [services.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/services.js#L213)
- [workspace.service.js](/home/merc/Development/current/jskit-ai/packages/workspace/workspace-service-core/src/shared/services/workspace.service.js#L489)

Key server behavior:
- `createWorkspaceService` receives the app `rbacManifest` and uses it to resolve permissions. [services.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/services.js#L213)
- `resolvePermissions()` maps role IDs to permissions; `owner` is explicitly elevated to `"*"`. [workspace.service.js](/home/merc/Development/current/jskit-ai/packages/workspace/workspace-service-core/src/shared/services/workspace.service.js#L489)
- `evaluateWorkspaceAccess()` uses surface-specific access logic (`appSurface` or `adminSurface`) and returns permissions that end up in bootstrap and request context. [workspace.service.js](/home/merc/Development/current/jskit-ai/packages/workspace/workspace-service-core/src/shared/services/workspace.service.js#L503)
- `resolveRequestContext()` enforces surface access rules, rejects denied workspace slugs, and returns `permissions` for the active workspace. [workspace.service.js](/home/merc/Development/current/jskit-ai/packages/workspace/workspace-service-core/src/shared/services/workspace.service.js#L766)
- `buildBootstrapPayload()` includes `permissions` for the active workspace, which becomes `workspaceStore.permissions`. [workspace.service.js](/home/merc/Development/current/jskit-ai/packages/workspace/workspace-service-core/src/shared/services/workspace.service.js#L818)

## 42. Console Role Catalog: Source of Console Permissions

Source: [consoleRoles.js](/home/merc/Development/current/jskit-ai/packages/workspace/workspace-console-core/src/shared/consoleRoles.js#L1)

Console RBAC is separate from workspace RBAC:
- Role IDs: `console` (super-user), `devop`, `moderator`. [consoleRoles.js](/home/merc/Development/current/jskit-ai/packages/workspace/workspace-console-core/src/shared/consoleRoles.js#L1)
- `console` role grants `"*"` (full permissions). [consoleRoles.js](/home/merc/Development/current/jskit-ai/packages/workspace/workspace-console-core/src/shared/consoleRoles.js#L17)
- `devop` role grants console errors read, billing manage/read, assistant settings manage, AI transcripts read/export. [consoleRoles.js](/home/merc/Development/current/jskit-ai/packages/workspace/workspace-console-core/src/shared/consoleRoles.js#L22)
- Management permissions used by console admin views are defined in `CONSOLE_MANAGEMENT_PERMISSIONS`. [consoleRoles.js](/home/merc/Development/current/jskit-ai/packages/workspace/workspace-console-core/src/shared/consoleRoles.js#L41)
- Default invite role for console is `moderator`. [consoleRoles.js](/home/merc/Development/current/jskit-ai/packages/workspace/workspace-console-core/src/shared/consoleRoles.js#L101)

These strings directly match `consoleStore.can("console.*")` checks in frontend.

## 43. Console Service Builds Console Bootstrap + Enforces Permissions

Sources:
- [consoleAccess.service.js](/home/merc/Development/current/jskit-ai/packages/workspace/workspace-console-service-core/src/shared/services/consoleAccess.service.js#L7)
- [console.service.js](/home/merc/Development/current/jskit-ai/packages/workspace/workspace-console-service-core/src/shared/services/console.service.js#L18)

Key enforcement points:
- `resolveRequestContext()` resolves console membership and permissions; if user is not active, permissions are empty and `hasAccess` is false. [consoleAccess.service.js](/home/merc/Development/current/jskit-ai/packages/workspace/workspace-console-service-core/src/shared/services/consoleAccess.service.js#L126)
- `requireConsoleAccess()` and `requirePermission()` enforce access and console permissions with 403 errors. [consoleAccess.service.js](/home/merc/Development/current/jskit-ai/packages/workspace/workspace-console-service-core/src/shared/services/consoleAccess.service.js#L152)
- `buildBootstrapPayload()` returns membership, permissions, role catalog, and pending invites for the console surface. [console.service.js](/home/merc/Development/current/jskit-ai/packages/workspace/workspace-console-service-core/src/shared/services/console.service.js#L191)

This is the server-side source of `consoleStore.permissions`, `hasAccess`, and `pendingInvites` used in the console UI.

## 44. Console Action Contributors Enforce Permissions Server-Side

Sources:
- [consoleCore.contributor.js](/home/merc/Development/current/jskit-ai/packages/workspace/workspace-console-service-core/src/shared/actions/consoleCore.contributor.js#L57)
- [consoleErrors.contributor.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/consoleErrors.contributor.js#L42)
- [consoleBilling.contributor.js](/home/merc/Development/current/jskit-ai/packages/billing/billing-service-core/src/shared/actions/consoleBilling.contributor.js#L542)

Highlights:
- Console core actions enforce permissions: `console.settings.update` requires `console.assistant.settings.manage`, members/invites routes require console management permissions. [consoleCore.contributor.js](/home/merc/Development/current/jskit-ai/packages/workspace/workspace-console-service-core/src/shared/actions/consoleCore.contributor.js#L117)
- Console errors actions require `console.errors.*.read` for list/get; `console.errors.browser.record` is public (no permission required), consistent with error-reporting semantics. [consoleErrors.contributor.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/consoleErrors.contributor.js#L56)
- Console billing actions enforce `console.billing.*` permissions for settings, events, and catalog/operations. [consoleBilling.contributor.js](/home/merc/Development/current/jskit-ai/packages/billing/billing-service-core/src/shared/actions/consoleBilling.contributor.js#L542)

## 45. Workspace Server Actions Enforce the Same Permissions as UI

Sources:
- [projects.contributor.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/projects.contributor.js#L314)
- [deg2radHistory.contributor.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/deg2radHistory.contributor.js#L133)
- [communications.contributor.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/communications.contributor.js#L21)

Examples:
- Projects list/get require `projects.read`; create/update require `projects.write`. [projects.contributor.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/projects.contributor.js#L314)
- History list requires `history.read`, and calculation write requires `history.write`. [deg2radHistory.contributor.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/deg2radHistory.contributor.js#L133)
- Workspace SMS send requires `workspace.members.invite`, matching admin UI gating. [communications.contributor.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/communications.contributor.js#L21)

These action-level permissions are enforced regardless of UI checks.

## 46. Updated Client-Only Assumptions (Server Truth)

New server findings add more client-only assumptions:
- App surface deny lists (`appDenyEmailsText` in workspace settings) are enforced server-side in `appSurface.js` but not checked by the frontend. [appSurface.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/surfaces/appSurface.js#L55)
- Console permissions come from `consoleRoles` and `consoleAccess` server logic, not from the workspace RBAC manifest. The frontend assumes `consoleStore.permissions` are accurate, but the source is entirely server-side. [consoleAccess.service.js](/home/merc/Development/current/jskit-ai/packages/workspace/workspace-console-service-core/src/shared/services/consoleAccess.service.js#L126)
- Console error reporting (`console.errors.browser.record`) is public on the server; the frontend does not gate it. This is intentional and must be guarded at the server layer. [consoleErrors.contributor.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/consoleErrors.contributor.js#L136)

This file is a consolidated, high-detail analysis based on direct source reads. It focuses on how permissions are declared (route metadata), enforced (auth prehandler + action runtime + service policy), and how workspace/console context affects billing, social, and chat domains.

## Primary Sources Read (Key Files)

### Cross-cutting auth/runtime
- `packages/auth/fastify-auth-policy/src/shared/routeMeta.js`
- `packages/auth/fastify-auth-policy/src/shared/plugin.js`
- `apps/jskit-value-app/server/fastify/auth.plugin.js`
- `apps/jskit-value-app/server/fastify/registerApiRoutes.js`
- `apps/jskit-value-app/server/runtime/actions/buildExecutionContext.js`
- `packages/runtime/action-runtime-core/src/shared/policies.js`
- `packages/runtime/action-runtime-core/src/shared/contracts.js`
- `packages/auth/rbac-core/src/shared/index.js`
- `apps/jskit-value-app/shared/rbac.manifest.json`
- `packages/workspace/workspace-service-core/src/shared/lookups/workspaceRequestContext.js`

### Billing
- `packages/billing/billing-fastify-routes/src/shared/routes.js`
- `packages/billing/billing-fastify-routes/src/shared/controller.js`
- `packages/billing/billing-service-core/src/shared/actions/workspaceBilling.contributor.js`
- `packages/billing/billing-service-core/src/shared/policy.service.js`
- `packages/billing/billing-service-core/src/shared/service.js`
- `packages/billing/billing-service-core/src/shared/checkoutOrchestrator.service.js`
- `apps/jskit-value-app/tests/billingRoutesPolicy.test.js`

### Social
- `packages/social/social-fastify-routes/src/shared/routes.js`
- `packages/social/social-fastify-routes/src/shared/controller.js`
- `packages/social/social-core/src/shared/actions/social.contributor.js`
- `packages/social/social-core/src/shared/service.js`

### Chat
- `packages/chat/chat-fastify-routes/src/shared/routes.js`
- `packages/chat/chat-fastify-routes/src/shared/controller.js`
- `packages/chat/chat-core/src/shared/actions/chat.contributor.js`
- `packages/chat/chat-core/src/shared/service.js`

## Part II — Domain and Cross-Domain Addendum

## A. Core Enforcement Pipeline (Shared)

### A1. Route metadata defaults and merge
- Default policy meta is permissive: `authPolicy: public`, `workspacePolicy: none`, `workspaceSurface: ""`, `permission: ""`.
  - `routeMeta.js:13-21`
- Route metadata is merged into Fastify config via `mergeAuthPolicy`.
  - `registerApiRoutes.js:18-28`

### A2. Auth prehandler behavior
- Auth prehandler runs only for `/api/...`.
- If `authPolicy` is `required`, it authenticates and sets `request.user`.
- Workspace/console context resolution occurs **only if**:
  - `workspacePolicy != none` OR `meta.permission` is set.
  - `plugin.js:207-218`
- Route permission check runs only if `meta.permission` is non-empty.
  - `plugin.js:220-241`

### A3. App-specific context resolution
- Surface resolution: explicit `workspaceSurface` -> `x-surface-id` header -> pathname.
  - `auth.plugin.js:20-33`
- If surface is `console`, `consoleService.resolveRequestContext` is used; otherwise workspace service.
  - `auth.plugin.js:80-112`

### A4. Action runtime permission enforcement
- Actions are executed with `context.channel = "api"` by controllers.
- Action runtime enforces in order:
  - channel allowlist
  - surface allowlist
  - visibility (operator-only gating)
  - permission policy
  - `policies.js:80-129`
- Permission policy supports:
  - function policy
  - array of permissions (all required)
  - `policies.js:27-73`
- Action definitions must include a permission policy (function or non-empty list).
  - `contracts.js:124-135`

### A5. Execution context assembly
- `buildExecutionContext` uses explicit `permissions` if provided; otherwise uses `request.permissions`.
  - `buildExecutionContext.js:70-80`
- Surface resolution also uses header `x-surface-id` if no explicit surface.
  - `buildExecutionContext.js:13-29`

### A6. RBAC manifest semantics (critical for chat)
- `manifestIncludesPermission` returns true if any role has the permission or `*`.
  - `rbac-core/index.js:164-189`
- Owner role always includes `*` and is always present in normalized manifest.
  - `rbac-core/index.js:14-76`

## B. RBAC Manifest Snapshot (Relevant Permissions)

Source: `apps/jskit-value-app/shared/rbac.manifest.json`

- `owner`: `*` (all permissions)
- `admin`: includes `workspace.billing.manage`, `chat.read`, `chat.write`, `social.read`, `social.write`, `social.moderate`.
  - `rbac.manifest.json:9-31`
- `member`: includes `chat.read`, `chat.write`, `social.read`, `social.write`.
  - `rbac.manifest.json:33-44`
- `viewer`: includes `social.read` only.
  - `rbac.manifest.json:46-49`

## C. Billing Domain (Routes → Actions → Policy → Service)

### C1. Billing routes: metadata (no route permission)
All billing API routes are `auth: required` and `workspacePolicy: optional`, **no `permission` field**.

Routes and metadata (selected, all in file):
- `GET /api/billing/plans` (`auth: required`, `workspacePolicy: optional`)
  - `billing-fastify-routes/routes.js:8-19`
- `GET /api/billing/products` `routes.js:22-34`
- `GET /api/billing/purchases` `routes.js:36-48`
- `GET /api/billing/plan-state` `routes.js:50-62`
- `GET /api/billing/payment-methods` `routes.js:64-75`
- `POST /api/billing/payment-methods/sync` `routes.js:78-90`
- `POST /api/billing/payment-methods/:paymentMethodId/default` `routes.js:92-109`
- `POST /api/billing/payment-methods/:paymentMethodId/detach` `routes.js:111-128`
- `DELETE /api/billing/payment-methods/:paymentMethodId` `routes.js:130-143`
- `GET /api/billing/limitations` `routes.js:145-156`
- `GET /api/billing/timeline` `routes.js:159-174`
- `POST /api/billing/checkout` `routes.js:177-193`
- `POST /api/billing/plan-change` `routes.js:195-210`
- `POST /api/billing/plan-change/cancel` `routes.js:213-225`
- `POST /api/billing/portal` `routes.js:227-242`
- `POST /api/billing/payment-links` `routes.js:245-261`

Webhooks are public:
- `POST /api/billing/webhooks/stripe`: `auth: public`, `workspacePolicy: none`, `csrfProtection: false`.
  - `routes.js:263-277`
- `POST /api/billing/webhooks/paddle`: same structure.
  - `routes.js:279-293`

Tests explicitly assert the policy intent:
- Write routes do **not** set route `permission`.
  - `billingRoutesPolicy.test.js:69-87`

### C2. Billing controller → action IDs
Controllers execute actions with `channel: "api"`.
- `executeAction` uses `context: { request, channel: "api" }`.
  - `billing-fastify-routes/controller.js:38-46`
- Idempotency-Key required for many mutations:
  - `requireIdempotencyKey()` and usage in
    - payment method mutations `controller.js:111-152`
    - checkout, plan change, portal, payment link `controller.js:175-223`

### C3. Billing action contributor (workspace billing)
All workspace billing actions:
- `surfaces: ["admin"]` only.
- `channels: ["api", "internal"]`.
- `permission: requireWorkspaceBillingManageOrSelf`.
  - `workspaceBilling.contributor.js:262-613`

Key permission helper:
- `requireWorkspaceBillingManageOrSelf(context, input)`:
  - denies if unauthenticated
  - **allows** if no workspace selected
  - otherwise requires `workspace.billing.manage`
  - `workspaceBilling.contributor.js:85-98`

Request/context resolution inside action layer:
- `resolveUser`: prefers `input.user`, then request user, then context actor.
  - `workspaceBilling.contributor.js:38-41`
- `resolveWorkspace`: uses `input.workspace` first, then request workspace, then context.
  - `workspaceBilling.contributor.js:43-46`
- `resolveRequest`: if no request in context, builds request from input; injects `x-workspace-slug` when possible.
  - `workspaceBilling.contributor.js:57-78`

Idempotency per action is explicit in contributor:
- `WORKSPACE_BILLING_ACTION_IDEMPOTENCY` map.
  - `workspaceBilling.contributor.js:121-138`

### C4. Billing policy service (primary authz)
Selectors:
- Workspace selector: `x-workspace-slug` header, then params, then query.
  - `policy.service.js:16-33`
- Billable entity selector: `x-billable-entity-id` header, then params, then query.
  - `policy.service.js:35-52`

Entity resolution:
- `resolveBillableEntityFromSelector(...)`:
  - if entity type is `workspace`, requires membership in that workspace, and if `forWrite`, requires billing permission.
  - `policy.service.js:229-259`
- `assertBillingWritePermission` enforces `workspace.billing.manage`.
  - `policy.service.js:276-289`

Read vs write selection behavior:
- `resolveBillableEntityForReadRequest`:
  - prefers billable-entity selector
  - if workspace selector present, allows selection without strictness
  - if no selector, falls back to user-scoped billable entity
  - `policy.service.js:292-325`
- `resolveBillableEntityForWriteRequest`:
  - prefers billable-entity selector (with write permission if workspace entity)
  - if workspace selector present, requires strict selection and write permission
  - if no selector, falls back to user-scoped billable entity
  - `policy.service.js:327-361`

Notable consequence:
- A write request with **no selectors** defaults to user-scoped entity (even if the user belongs to multiple workspaces).
  - `policy.service.js:356-361`

### C5. Billing service usage
Billing service requires policy service and uses it for read/write operations:
- Dependency requirement: `billingPolicyService` must be present.
  - `billing-service-core/service.js:476-505`

Read operations call `resolveBillableEntityForReadRequest`:
- `listPlans` `service.js:688-734`
- `listProducts` `service.js:736-760`
- `listPurchases` `service.js:767-770`
- `getPlanState` `service.js:1388-1403`
- `listPaymentMethods` `service.js:2706-2712`
- `getLimitations` `service.js:3120-3125`
- `listTimeline` `service.js:3155-3161`

Write operations call `resolveBillableEntityForWriteRequest`:
- `requestPlanChange` `service.js:1405-1410`
- `cancelPendingPlanChange` `service.js:1706-1712`
- `syncPaymentMethods` `service.js:2724-2729`
- `resolvePaymentMethodForWrite` `service.js:2964-2999`
- `createPortalSession` `service.js:3361-3366`
- `createPaymentLink` `service.js:4003-4008`

Checkout orchestrator re-checks write access:
- `startCheckout` re-resolves billable entity with write policy.
  - `checkoutOrchestrator.service.js:1640-1644`

### C6. Billing permission enforcement summary
- **Route layer**: no `permission` metadata → no route RBAC check.
- **Action layer**: `requireWorkspaceBillingManageOrSelf` gate.
- **Policy/service layer**: `assertBillingWritePermission` and entity ownership/membership enforcement.

## D. Social Domain (Routes → Actions → Service)

### D1. Social routes: metadata
All workspace social routes set `auth: required`, `workspacePolicy: required`, `workspaceSurface: app` (or admin for moderation), and explicit `permission` strings.

Core workspace social endpoints (examples, all follow same pattern):
- Feed read: `GET /api/workspace/social/feed` → `permission: social.read`.
  - `social-fastify-routes/routes.js:35-53`
- Post create: `POST /api/workspace/social/posts` → `permission: social.write`.
  - `routes.js:55-73`
- Post get: `GET /api/workspace/social/posts/:postId` → `permission: social.read`.
  - `routes.js:75-90`
- Post update/delete, comments, follows, actors, notifications: all require `social.read` or `social.write` and `workspaceSurface: app`.
  - `routes.js:92-279`

Moderation endpoints:
- `GET /api/workspace/admin/social/moderation/rules` → `permission: social.moderate`, `workspaceSurface: admin`.
  - `routes.js:282-297`
- `POST /api/workspace/admin/social/moderation/rules` → `permission: social.moderate`.
  - `routes.js:299-317`
- `DELETE /api/workspace/admin/social/moderation/rules/:ruleId` → `permission: social.moderate`.
  - `routes.js:319-333`

Federation (public) endpoints:
- Webfinger / actor / followers / following / outbox / object docs:
  - `auth: public`, `workspacePolicy: none`, `csrfProtection: false`.
  - `routes.js:336-433`
- Shared inbox and actor inbox:
  - public, csrf off, `bodyLimit` enforced.
  - `routes.js:435-467`

### D2. Social controller → action IDs
- Controllers map all routes to action IDs and use `context: { request, channel: "api" }`.
  - `social-fastify-routes/controller.js:27-35`
- Inbox routes pass `requestMeta` including signature/digest/method/path/rawBody.
  - `controller.js:321-357`

### D3. Social actions (permission + surface)
Core actions:
- `permission`: `requireAuthenticated && requireWorkspaceContext` (not RBAC string check).
- `surfaces`: `["app", "admin"]`.
- `channels`: `["api", "internal"]`.
  - Example: `social.feed.read` `social.contributor.js:87-108`
  - Example: `social.post.create` includes `assistant_tool` channel.
    - `social.contributor.js:133-147`

Moderation actions:
- `surfaces: ["admin"]`.
- `visibility`: `"operator"` if moderationAccessMode is `operator`, else `"public"`.
- `permission`: `() => true` in operator mode, else `["social.moderate"]`.
  - `social.contributor.js:36-55`, `500-553`

Federation actions:
- `permission: () => true` for webfinger/actor/followers/following/outbox/object.
- `surfaces: ["app", "admin", "console"]`.
- `visibility: "public"`.
  - `social.contributor.js:568-698`
- Inbox processing:
  - `visibility: "internal"` (note: runtime only treats `"operator"` specially).
  - `channels: ["api", "internal", "worker"]`.
  - `permission: () => true`.
  - `social.contributor.js:700-719`
- Outbox deliveries:
  - `channels: ["internal", "worker"]`.
  - `permission: () => true`.
  - `social.contributor.js:724-743`

### D4. Social service policy (feature gating + auth presence)
- `resolveRuntimePolicy` derives:
  - `enabled`, `federationEnabled`, moderation access mode, limits, blocked domains, etc.
  - `social.service.js:147-208`
- `assertEnabled()` throws `404` if social disabled.
  - `service.js:843-846`
- `assertFederationEnabled()` throws `404` if federation disabled.
  - `service.js:849-852`

Service-level auth/workspace enforcement:
- `resolveWorkspaceId` → 409 if missing.
  - `service.js:51-58`
- `resolveActorUserId` → 401 if missing.
  - `service.js:60-66`

Examples where `assertEnabled` is used:
- `listFeed` `service.js:1228-1233`
- `getPost` `service.js:1274-1276`
- `createPost` `service.js:1312-1314`
- moderation methods `service.js:1873-1932`

Examples where `assertFederationEnabled` is used:
- `fetchRemoteActorByHandle` `service.js:1116-1121`
- `fetchAndCacheRemoteActor` `service.js:1163-1167`

### D5. Social permission enforcement summary
- **Route layer**: explicit `social.read/write/moderate` RBAC strings for workspace APIs.
- **Action layer**: requires auth + workspace context, not RBAC strings.
- **Service layer**: enforces auth/workspace presence + feature flags; no `social.*` RBAC check.

## E. Chat Domain (Routes → Actions → Service)

### E1. Chat routes: metadata
All chat routes:
- `auth: required`
- `workspacePolicy: none`
- no `permission`
- no `workspaceSurface`

Examples:
- `POST /api/chat/workspace/ensure` `routes.js:35-52`
- `GET /api/chat/inbox` `routes.js:98-118`
- `POST /api/chat/threads/:threadId/messages` `routes.js:165-186`
- `POST /api/chat/threads/:threadId/typing` `routes.js:297-314`

Because `workspacePolicy` is `none` and `permission` is empty, auth prehandler does **not** resolve workspace context for chat routes.

### E2. Chat controller → action IDs
- Chat controllers execute action IDs with `context: { request, channel: "api" }`.
  - `chat-fastify-routes/controller.js:97-105`

### E3. Chat action contributor
All chat actions:
- `permission: requireAuthenticated` only (no RBAC string list).
- `surfaces: ["app", "admin", "console"]`.
- `channels: ["api", "internal"]` (message send also allows `assistant_tool`).
  - `chat.contributor.js:96-281`

Surface resolution inside action layer:
- `resolveSurfaceId` prefers `input.surfaceId`, then `x-surface-id` header, then context surface, default `app`.
  - `chat.contributor.js:10-18`

Request metadata for message send:
- includes `x-workspace-slug`, `x-command-id`, `x-client-id` when present.
  - `chat.contributor.js:30-43`

`chat.thread.message.send`:
- channels include `assistant_tool`.
- idempotency `domain_native`.
  - `chat.contributor.js:233-264`

### E4. Chat service enforcement (primary)
Surface sets:
- Workspace thread access allowed surfaces: `app`, `admin` only.
  - `chat.service.js:10-11`
- Inbox surface allowlist includes `console`.
  - `chat.service.js:11-12`

Surface normalization:
- `normalizeSurfaceIdForInbox` throws on invalid surface.
  - `chat.service.js:125-135`
- `normalizeSurfaceIdForThreadAccess` returns `"invalid"` if not in allowlist.
  - `chat.service.js:138-149`

Permission enforcement logic:
- `shouldEnforceWorkspacePermission` uses `manifestIncludesPermission(..., includeOwner: true)`.
  - `chat.service.js:742-744`
  - Because owner has `*`, this effectively returns true for any permission when a manifest exists.
- `resolveWorkspaceMembershipAccess`:
  - requires active membership
  - if no rbacManifest: skips permission check (membership-only)
  - else checks `chat.read` / `chat.write` via role permissions
  - `chat.service.js:1021-1041`

Thread access gating:
- `resolveThreadAccess`:
  - requires thread + active participant
  - workspace threads: feature flag on, surface in `WORKSPACE_SURFACE_IDS`, and permission check
  - global threads: feature flag on
  - `chat.service.js:1044-1093`

Workspace room ensure:
- uses `lastActiveWorkspaceId` from user settings
- requires `chat.read` via `resolveWorkspaceMembershipAccess`
  - `chat.service.js:1401-1424`

Inbox listing:
- uses `normalizeSurfaceIdForInbox`
- filters workspace threads to the active workspace
- excludes workspace threads for `console` surface
  - `chat.service.js:1678-1723`

### E5. Chat permission enforcement summary
- **Route layer**: auth only; no RBAC permission.
- **Action layer**: auth only.
- **Service layer**: feature flags + membership + RBAC permission checks (if manifest provided).

## F. Permission Presence vs Absence Matrix (Route Metadata)

- **Billing**:
  - Route `permission`: none.
  - `workspacePolicy`: optional on all core APIs.
  - `auth`: required.
  - Enforcement deferred to action + policy service.
  - `billing-fastify-routes/routes.js:8-261`

- **Social**:
  - Route `permission`: explicit `social.read/write/moderate` on workspace endpoints.
  - `workspacePolicy`: required.
  - `workspaceSurface`: `app` for core, `admin` for moderation.
  - Federation endpoints are public and have no permission.
  - `social-fastify-routes/routes.js:35-333` and `:336-467`

- **Chat**:
  - Route `permission`: none.
  - `workspacePolicy`: none.
  - `auth`: required.
  - Service-level enforcement only.
  - `chat-fastify-routes/routes.js:35-360`

## G. Notable Risks / Weak Spots (Based on Source Evidence)

### G1. Billing lacks route-level permission checks
- Route permissions are absent by design; tests assert this.
  - `billingRoutesPolicy.test.js:69-87`
- Risk: any new entrypoint bypassing billing action/service layers would skip RBAC enforcement.

### G2. Billing write operations can be user-scoped when no selector provided
- `resolveBillableEntityForWriteRequest` falls back to user entity if no workspace or entity selector.
  - `policy.service.js:327-361`
- Risk: operations may be broader than intended if callers omit selectors.

### G3. Social RBAC strings enforced primarily at route layer
- Actions require only auth + workspace context; service does not check `social.read/write/moderate`.
  - `social.contributor.js:18-29`, `service.js:51-66`
- Risk: internal action execution bypassing route metadata skips RBAC string checks.

### G4. Social moderation access mode "operator"
- In `operator` mode, permission policy becomes `() => true` and visibility is `operator`.
  - `social.contributor.js:36-55`, `500-553`
- Enforcement shifts from `social.moderate` to action runtime operator visibility.
  - `policies.js:110-129`
- Risk: misconfiguration can unintentionally broaden moderation access or rely on operator status unexpectedly.

### G5. Chat permission enforcement depends on rbacManifest presence
- If `rbacManifest` is missing, permissions are not checked (membership-only access).
  - `chat.service.js:1021-1031`
- In normal app configuration, manifest exists and **permissions are always enforced** because owner role has `*`.
  - `rbac-core/index.js:14-44`, `164-189`
- Risk: if chat service is instantiated without manifest, permission checks degrade to membership-only.

### G6. Header-driven surface influence for chat
- `resolveSurfaceId` uses `x-surface-id` if present.
  - `chat.contributor.js:10-18`
- `normalizeSurfaceIdForInbox` throws on invalid surface, but does allow `console` and affects inbox filtering.
  - `chat.service.js:125-1723`
- Risk: surface is partially caller-controlled via header; service logic must remain authoritative.

### G7. Action visibility "internal" is not enforced by runtime
- Action runtime only enforces visibility when `visibility === "operator"`.
  - `policies.js:110-129`
- Social federation inbox/outbox actions use `visibility: "internal"` but still allow `api` channel and `permission: () => true`.
  - `social.contributor.js:700-719`
- Risk: do not rely on `visibility: "internal"` for access control; channel + route auth are the real gate.

## H. Concrete Permission Enforcement Mapping (By Domain)

### H1. Billing
- **Route layer**: auth + optional workspace context only.
  - `billing-fastify-routes/routes.js:8-261`
- **Action layer**: `requireWorkspaceBillingManageOrSelf` permission function.
  - `workspaceBilling.contributor.js:85-98`
- **Policy/service layer**: `assertBillingWritePermission` and entity ownership enforcement.
  - `policy.service.js:229-289`

### H2. Social
- **Route layer**: explicit `social.read/write/moderate` checks.
  - `social-fastify-routes/routes.js:35-333`
- **Action layer**: requires auth + workspace context, not RBAC strings.
  - `social.contributor.js:18-29`, `87-198`
- **Service layer**: enforces auth/workspace presence + feature flags; federation gating.
  - `service.js:51-66`, `843-852`

### H3. Chat
- **Route layer**: auth only, no workspace context resolution.
  - `chat-fastify-routes/routes.js:35-360`
- **Action layer**: auth only, surfaces include console.
  - `chat.contributor.js:96-281`
- **Service layer**: membership + permission checks with manifest.
  - `chat.service.js:1021-1073`

## I. Additional Observations (Cross-Cutting)

- `buildExecutionContext` allows explicit `permissions` override. This can bypass request permissions if internal callers provide a different set.
  - `buildExecutionContext.js:58-80`
- `workspaceRequestContext.resolveRequestSurfaceId` and `auth.plugin.resolveRequestSurface` both allow `x-surface-id` to influence surface.
  - `workspaceRequestContext.js:34-53`
  - `auth.plugin.js:20-33`
- Billing action helper `resolveRequest` will inject `x-workspace-slug` from input workspace if header missing. This can influence policy selection downstream.
  - `workspaceBilling.contributor.js:57-78`
- Action runtime surface/channel checks remain strict; action definitions list allowed surfaces and channels.
  - `policies.js:80-107`

## J. Summary (Most Important Takeaways)

1) **Billing**: no route-level RBAC; permissions enforced by action function + billing policy service. Writes can become user-scoped if selectors are omitted.
2) **Social**: RBAC strings enforced at route layer. Actions/services only check auth + workspace + feature flags. Federation is public and relies on channel + service-level checks.
3) **Chat**: route/action are auth-only; service is authoritative. Workspace thread access requires membership + `chat.read/write` when manifest exists.
4) **Surface headers matter**: `x-surface-id` influences action surface and inbox filtering; keep service checks authoritative.
5) **Operator vs permission mode**: Social moderation uses `visibility: operator` in operator mode; permission policy shifts accordingly.

## K. If You Want More Precision Next

1. Produce a route-by-route permission matrix for social (every path with permission string) and chat (every path with absence of permission) with full line references.
2. Trace any internal worker/cron entrypoints that execute social or billing actions directly to verify they supply the correct `context.permissions` and `surface`.
3. Validate that chat service is always constructed with `rbacManifest` in runtime wiring.
