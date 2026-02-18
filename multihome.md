• Target Outcome

1. One scaffold architecture that works as solo app on day one.
2. Same architecture upgrades to team and multi-workspace without schema
   rewrites.
3. Collaboration is always permission-backed, never “member = full access”.

Core Principles

1. workspace_id is mandatory on all workspace-owned domain records.
2. Collaboration depends on RBAC being present and valid.
3. App config is dev-owned and boot-loaded only.
4. Workspace config is workspace-admin owned and persisted per workspace.
5. User config is user-owned and persisted per user.
6. /api/bootstrap hydrates runtime context for the active workspace.

Product Modes (Policy Profiles)
| Profile | Workspaces/User | Invites | Workspace Switcher | Typical Use |
|---|---:|---:|---:|---|
| personal (default) | 1 | Off | Off | Solo app |
| team-single | 1 | On | Off | One team workspace |
| multi-workspace | N | On | On | Agencies/SaaS/orgs |

Configuration Architecture

1. app config source is env + static manifest files, loaded in server.js at
   boot.
2. workspace config source is DB table keyed by workspace_id.
3. user config source is DB table keyed by user_id.
4. Client receives only safe/public app config subset.
5. Effective runtime config is computed per request from all three layers.

Effective Config Resolution

1. Start from app defaults.
2. Overlay workspace config for active workspace.
3. Overlay user config for presentation preferences only.
4. Do not allow user config to bypass workspace policy.
5. Do not allow workspace config to bypass hard app limits.

RBAC and Collaboration Coupling

1. Collaboration features require a valid RBAC manifest.
2. RBAC manifest must always include non-removable owner.
3. Invites require at least one assignable non-owner role.
4. If role set is empty or invalid, invites are disabled and role UI is
   hidden.
5. Backend enforces this invariant regardless of UI.

RBAC Manifest Contract

{
"version": 1,
"defaultInviteRole": "member",
"roles": {
"owner": {
"assignable": false,
"permissions": ["*"]
},
"admin": {
"assignable": true,
"permissions": [
"workspace.members.invite",
"workspace.members.manage",
"workspace.settings.update",
"workspace.roles.view"
]
},
"member": {
"assignable": true,
"permissions": [
"history.read",
"history.write"
]
}
}
}

Data Model

1. Add workspaces with id, slug, name, owner_user_id, is_personal, timestamps.
2. Add workspace_memberships with workspace_id, user_id, role_id, status,
   timestamps.
3. Add workspace_invites with workspace_id, email, role_id, token,
   invited_by_user_id, expires_at, status.
4. Add workspace_settings with workspace_id and policy/features JSON or typed
   columns.
5. Keep user_settings user-scoped and add last_active_workspace_id.
6. Add workspace_id to existing domain tables starting with calculation_logs.
7. Add created_by_user_id broadly for audit.
8. Add owner_user_id only on resources that need “own vs any” authorization.

DB Constraints and Indexing

1. Foreign keys from workspace-owned tables to workspaces.id.
2. Composite unique keys include workspace_id first for tenant isolation.
3. Membership uniqueness on (workspace_id, user_id).
4. Invite token uniqueness and short expiry indexes.
5. Slug uniqueness global for path/subdomain compatibility.

Workspace Resolution Strategy

1. Primary now is path mode: /w/:workspaceSlug/....
2. Future-compatible resolver supports host mode: :slug.example.com.
3. Fallback in personal mode can still route / to personal workspace.
4. Server-side resolver always maps slug to workspace_id.
5. Authz always uses workspace_id, never slug alone.

Active Workspace Selection Rules

1. If URL/host specifies workspace, use it if user has membership.
2. Else use user_settings.last_active_workspace_id if membership still valid.
3. Else if user has one membership, auto-select it.
4. Else return “workspace selection required”.
5. Persist selection to last_active_workspace_id after successful resolve.

/api/bootstrap Purpose

1. It is the single first-load payload for app + workspace + user context.
2. It should include all three config layers in safe/effective form.
3. It should include active workspace, membership, and resolved permissions.
4. It should include CSRF token only if you want to unify boot with session;
   otherwise keep it in /api/session.

/api/bootstrap Example

{
"session": {
"authenticated": true,
"userId": 42,
"username": "alice"
},
"app": {
"tenancyMode": "personal",
"features": {
"workspaceSwitching": false
}
},
"workspace": {
"id": 7,
"slug": "alice",
"name": "Alice Workspace",
"features": {
"invitesEnabled": false
}
},
"membership": {
"roleId": "owner"
},
"permissions": ["*"],
"workspaceSettings": {
"invitesEnabled": false
},
"userSettings": {
"theme": "system",
"locale": "en-US",
"lastActiveWorkspaceId": 7
}
}

API Surface Plan

1. Add GET /api/bootstrap.
2. Add GET /api/workspaces for memberships visible to current user.
3. Add POST /api/workspaces/select to set active workspace (optional if URL-
   driven only).
4. Add invites endpoints gated by permission and workspace feature.
5. Add memberships endpoints gated by permission.
6. Add workspace settings endpoints gated by workspace.settings.update.
7. Extend existing domain endpoints to require workspace context and
   permission keys.

Backend Integration Points

1. Extend plugins/auth.js or add plugins/workspaceContext.js for active
   workspace + permissions.
2. Extend routes/api/index.js route metadata with permission requirements.
3. Update repositories to scope tenant queries by workspace_id.
4. Keep auth/session service in services/authService.js and add workspace-
   aware helpers.
5. Add boot config loader module and manifest validator.

Frontend Integration Points

1. Initialize app using /api/bootstrap in src/main.js.
2. Add stores for workspace context and permissions.
3. Apply user settings and workspace features at startup.
4. Show/hide switcher, invites, and role UI from effective features +
   permissions.
5. Keep current Settings screen and add workspace sections behind gates.

Path Mode Now, Subdomain Later

1. Build one workspace resolver interface now.
2. Implement path resolver first.
3. Add host resolver later without changing repositories/services.
4. Keep slug stable and unique so both modes resolve same workspace.
5. Maintain /w/:slug as fallback even after subdomain launch.

Subdomain Readiness Requirements

1. Wildcard DNS and wildcard TLS cert at infra layer.
2. Cookie strategy reviewed for cross-subdomain behavior.
3. CSRF origin strategy reviewed for subdomain mode.
4. OAuth callback flow centralized or dynamically routed back to workspace.
5. CSP/connect-src adjusted if workspace hostnames vary.

Migration Plan for Current Scaffold

1. Create workspace tables.
2. Create one personal workspace per existing user profile.
3. Create owner membership for each personal workspace.
4. Backfill workspace_id on calculation_logs.
5. Make workspace_id non-null and indexed.
6. Add workspace_settings defaults.
7. Add last_active_workspace_id to user_settings.
8. Update repositories/services/routes to require workspace context.

Phased Delivery Plan

1. Phase 1: Boot config + RBAC manifest loader/validator.
2. Phase 2: Workspace schema + personal workspace backfill migrations.
3. Phase 3: Workspace context middleware + route permission metadata.
4. Phase 4: Tenant scoping in repositories (workspace_id enforcement).
5. Phase 5: /api/bootstrap and frontend startup hydration.
6. Phase 6: Workspace selection flow and last_active_workspace_id.
7. Phase 7: Invites/memberships APIs and UI gates.
8. Phase 8: Optional multi-workspace creation/switcher UX.
9. Phase 9: Subdomain resolver support and infrastructure enablement.

Acceptance Criteria

1. Personal mode works with zero team UI and zero invites.
2. Enabling RBAC + invites requires no schema rewrite.
3. All workspace-owned reads/writes are scoped by workspace_id.
4. Collaboration APIs fail closed when permissions are missing.
5. Multi-workspace mode can be turned on via config and new UI only.
6. Path and subdomain modes resolve to identical workspace context behavior.

Critical Decisions to Lock Before Implementation

1. Canonical routing style at launch: /w/:slug only, or mixed.
2. Where defaultInviteRole lives: app manifest only, or overridable per
   workspace.
3. Whether owner can transfer ownership via API in v1.
4. Whether permissions are static from manifest only in v1, or workspace-
   customizable in v2.
5. Whether /api/bootstrap also returns CSRF, or CSRF remains only on /api/
   session.

If you want, next step is I can convert this into an execution backlog mapped
to your current files (server.js, routes/api/index.js, plugins/auth.js,
repositories, and frontend stores/views) with exact migration filenames and
endpoint contracts.

› We should also engineer a page where the user has no actual workspace -- a
generic "you are logged in" page, from where they can pick the workspace.
This also means that if they do pick a workspace, the systme will need to
send over that workspace's settings. But also if there is single tenancy,
that page should be... I am not sure.

• Yes, you should add that page. It solves a real state: authenticated=true and
activeWorkspace=null.

Recommended model

1. Treat auth and workspace as separate contexts.
2. Keep routes split into:
3. public (login/reset),
4. authenticated-no-workspace (workspace picker/onboarding),
5. workspace-required (main app).

Gateway page (/workspaces)

1. If user has 0 memberships: show “You’re logged in, but you don’t have a
   workspace yet.”
2. If user has 1 membership: auto-select and redirect by default.
3. If user has >1 memberships: show picker.
4. If app allows creating personal workspace: show Create workspace.
5. If app is invite-only: show “Request access / contact admin”.

How workspace settings are loaded

1. /api/bootstrap should always return session + workspace list summary +
   active workspace (nullable).
2. If active workspace exists, bootstrap also returns workspace settings +
   permissions.
3. If active workspace is null, those fields are null/empty.
4. On selection, call POST /api/workspaces/select and return full workspace
   context immediately (settings + permissions + role), then navigate.

Single-tenancy behavior

1. In personal mode, auto-provision one personal workspace on first login.
2. Usually skip the gateway entirely (direct redirect).
3. Keep gateway as fallback for broken/migrating states only.
4. Hide switcher/invite UI in personal mode.

Net effect

1. No friction for single-app users.
2. Clean UX for multi-workspace users.
3. Correct architecture for future slug.example.com routing.

⚠ Heads up, you have less than 5% of your weekly limit left. Run /status for a
breakdown.

› OK now give me a VERY VERY VERY VERY detailed writeup of everything we talked
about. This is something I will pass on to the next session so that it can do
ALL of this work. DOn't leave any detail out.

• Outlining comprehensive structured implementation brief

• Comprehensive Implementation Brief: Workspace-Native Scaffold with Personal-
Mode Default

## 1) Goals and decisions we already agreed

1. This scaffold should support both solo and multi-workspace/team apps
   without architectural rewrites.
2. “Single app” should be implemented as a policy profile of a workspace-
   native system, not a different architecture.
3. Collaboration and authorization are tightly coupled in practice; invites
   must not exist without a permission model.
4. Role/permission design should be Drupal-style in spirit: named roles, named
   permissions, role grants defined by JSON manifest, role assignment done by
   workspace admins.
5. If the roles/permissions manifest is empty or unusable, invites and
   permissions UI should be disabled.
6. A system owner capability should still exist internally so authz never
   becomes undefined.
7. Workspace-scoped domain records should carry workspace_id from day one to
   keep upgrade path easy.
8. owner_user_id should exist only on resources where “own vs any” permission
   semantics matter; not every table needs it.
9. created_by_user_id (and optionally updated_by_user_id) should be used
   broadly for auditability.
10. /api/bootstrap should hydrate startup context and can cover app,
    workspace, and user config layers.
11. Do not assume the user always knows/has an active workspace at login time;
    introduce an authenticated “no active workspace” page.
12. Workspace slug should be canonical in DB (workspaces.slug) and used as
    routing alias; real auth key remains workspace_id.
13. Future slug.example.com is feasible with minimal pain if resolver
    abstraction is designed now.
14. Personal/single-tenancy should usually bypass workspace picker by auto-
    provisioning and auto-selecting a personal workspace, but fallback page
    should still exist for edge states.

———

## 2) Configuration architecture (3-layer model)

| Layer                                   | Owner                                       | Persistence                                   | Mutability | Scope    | Example fields |
| --------------------------------------- | ------------------------------------------- | --------------------------------------------- | ---------- | -------- | -------------- |
| App config                              | Developer/operator                          | Env + static manifest files                   | Boot-time  |
| only                                    | Global                                      | TENANCY_MODE, RBAC_MANIFEST_PATH, hard limits |
| Workspace config                        | Workspace admins                            | DB (workspace_settings)                       | Runtime    |
| Per workspace                           | invites_enabled, workspace modules/policies |
| User config                             | End user                                    | DB (user_settings)                            | Runtime    | Per user | theme,         |
| locale, defaults, last active workspace |

## 3) Effective config precedence

1. Start from app config defaults and hard caps.
2. Overlay workspace config for the active workspace.
3. Overlay user config only for user-personalizable surfaces.
4. Never allow user config to bypass workspace policy.
5. Never allow workspace config to bypass app-level hard limits.
6. Send only safe/public app config subset to the client.

———

## 4) Mode profiles (policy, not architecture)

| Profile            | Workspaces per user | Invites | Role UI | Workspace switcher |
| ------------------ | ------------------: | ------: | ------: | -----------------: |
| personal (default) |                   1 |     Off |  Hidden |             Hidden |
| team-single        |                   1 |      On | Visible |             Hidden |
| multi-workspace    |                   N |      On | Visible |            Visible |

———

## 5) RBAC model and collaboration coupling

1. Collaboration features require a valid RBAC manifest.
2. RBAC manifest must always define system owner.
3. Invites require at least one assignable non-owner role.
4. Invites also require a valid defaultInviteRole.
5. If manifest is empty or invalid, effective behavior is owner-only/personal
   mode with collaboration disabled.
6. Backend must enforce all rules regardless of UI visibility.
7. Membership alone must never grant unrestricted access.

———

## 6) Suggested RBAC manifest contract

{
"version": 1,
"defaultInviteRole": "member",
"roles": {
"owner": {
"assignable": false,
"permissions": ["*"]
},
"admin": {
"assignable": true,
"permissions": [
"workspace.members.invite",
"workspace.members.view",
"workspace.members.manage",
"workspace.invites.revoke",
"workspace.settings.update",
"workspace.roles.view",
"history.read",
"history.write"
]
},
"member": {
"assignable": true,
"permissions": [
"history.read",
"history.write"
]
},
"viewer": {
"assignable": true,
"permissions": [
"history.read"
]
}
}
}

———

## 7) Data model blueprint

## 7.1 New tables

| Table                          | Purpose                         | Key columns                                |
| ------------------------------ | ------------------------------- | ------------------------------------------ |
| workspaces                     | Workspace identity              | id, slug, name, owner_user_id, is_personal |
|                                |
| workspace_memberships          | User membership and role        | workspace_id, user_id,                     |
| role_id, status                |
| workspace_invites              | Pending invite workflow         | workspace_id, email, role_id,              |
| token_hash, status, expires_at |
| workspace_settings             | Workspace-level policy/features | workspace_id, feature                      |
| fields/JSON, timestamps        |

## 7.2 Existing table changes

1. Add workspace_id to workspace-owned domain tables, starting with
   calculation_logs.
2. Keep user_profiles identity-scoped (global user identity mirror).
3. Keep user_settings user-scoped and add last_active_workspace_id.
4. Keep/merge in-progress password_sign_in_enabled work consistently with
   auth-method policy.
5. Add created_by_user_id on new workspace-owned entities where audit is
   useful.
6. Add owner_user_id only where ownership checks are actually needed.

## 7.3 Constraints and indexes

1. workspaces.slug unique.
2. workspace_memberships unique on (workspace_id, user_id).
3. Tenant uniqueness patterns include workspace_id first.
4. FK on all tenant-owned rows to workspaces.id.
5. Invite token uniqueness and indexed expiry.
6. Prevent last-owner removal with service-level invariant checks.

———

## 8) workspace_id policy and ownership semantics

1. Use workspace_id on every workspace-owned record by default.
2. Do not use workspace_id on truly global/system tables.
3. Use owner_user_id only when authorization requires “own vs any” checks.
4. Use created_by_user_id and optional updated_by_user_id for audit instead of
   overloading ownership.
5. When owner_user_id exists, validate that owner is a member of same
   workspace.

———

## 9) Workspace resolution strategy (now + future)

1. Canonical DB identity is workspace_id.
2. Slug is routing alias and human-facing identifier.
3. Current recommended runtime mode is path-based (/w/:slug) for simplicity.
4. Prepare resolver abstraction now to support subdomain mode
   (slug.example.com) later.
5. Keep path fallback even after subdomain adoption.

## 9.1 Resolution precedence

1. Explicit requested workspace slug (query/header/path context).
2. user_settings.last_active_workspace_id.
3. Single-membership fallback if user has exactly one workspace.
4. Null active workspace if none of the above resolves.

———

## 10) /api/bootstrap contract (startup hydration)

## 10.1 Purpose

1. One startup call that returns session + workspace context + permissions +
   settings.
2. Powers immediate app theme/defaults and route decisions.
3. Covers app/workspace/user config layers in effective form.

## 10.2 Response shape

{
"session": {
"authenticated": true,
"userId": 42,
"username": "alice"
},
"app": {
"tenancyMode": "personal",
"features": {
"workspaceSwitching": false
}
},
"workspaces": [
{ "id": 7, "slug": "alice", "name": "Alice Workspace", "roleId": "owner" }
],
"activeWorkspace": {
"id": 7,
"slug": "alice",
"name": "Alice Workspace"
},
"membership": {
"roleId": "owner",
"status": "active"
},
"permissions": ["*"],
"workspaceSettings": {
"invitesEnabled": false
},
"userSettings": {
"theme": "system",
"locale": "en-US",
"defaultHistoryPageSize": 10,
"lastActiveWorkspaceId": 7
}
}

## 10.3 Null-active case response

1. session.authenticated = true.
2. workspaces may be empty or non-empty.
3. activeWorkspace = null.
4. membership = null.
5. permissions = [].
6. workspaceSettings = null.
7. userSettings still included.

———

## 11) Authenticated/no-workspace page requirement

1. Add route "/workspaces" as authenticated route that does not require active
   workspace.
2. Show “you are logged in” state with workspace chooser and/or create/join
   action.
3. Handle three states explicitly:
4. 0 memberships: show empty-state CTA (create personal workspace if allowed,
   or request invite).
5. 1 membership: auto-select and redirect by default.
6. > 1 memberships: present selection list/search.
7. In personal mode, this route exists but should generally be bypassed by
   auto-provision + auto-select.
8. Keep it as fallback for migration/inconsistent states.

———

## 12) Single-tenancy behavior specifics

1. On first successful login/register, ensure personal workspace exists for
   user.
2. Ensure owner membership exists for that personal workspace.
3. Set last_active_workspace_id to that workspace.
4. Redirect directly into workspace app route.
5. Hide workspace switcher and invites controls.
6. Keep backend workspace checks active anyway; no separate auth model.

———

## 13) API surface plan

| Endpoint                                | Auth                                   | Workspace required | Permission                 | Notes                 |
| --------------------------------------- | -------------------------------------- | -----------------: | -------------------------- | --------------------- |
| GET /api/bootstrap                      | required/public-authenticated fallback |                 No | N/A                        |
| Startup hydration                       |
| GET /api/workspaces                     | required                               |                 No | N/A                        | Membership summaries  |
| POST /api/workspaces/select             | required                               |                 No | N/A                        | Sets active workspace |
| and returns context                     |
| POST /api/workspaces                    | required                               |                 No | policy-driven              | Create workspace if   |
| allowed                                 |
| GET /api/workspace/settings             | required                               |                Yes | workspace.settings.view or |
| implicit member                         | Current workspace settings             |
| PATCH /api/workspace/settings           | required                               |                Yes | workspace.settings.update  |
| Workspace policy updates                |
| GET /api/workspace/members              | required                               |                Yes | workspace.members.view     |
| Membership management                   |
| PATCH /api/workspace/members/:userId    | required                               |                Yes |
| workspace.members.manage                | Role/status updates                    |
| POST /api/workspace/invites             | required                               |                Yes | workspace.members.invite   |
| Invite with role                        |
| GET /api/workspace/invites              | required                               |                Yes | workspace.members.view     |
| Pending invites                         |
| DELETE /api/workspace/invites/:inviteId | required                               |                Yes |
| workspace.invites.revoke                | Revoke invite                          |

———

## 14) Existing endpoint behavior updates

1. Keep existing auth endpoints intact (/api/login, /api/register, /api/
   session, etc.).
2. Keep /api/settings if needed for compatibility, but split semantics
   internally into user/workspace-aware data.
3. For workspace-owned endpoints like /api/history and /api/annuityCalculator,
   enforce workspace context and permissions.
4. Repository calls for workspace-owned resources must always include
   workspace_id.

———

## 15) Backend implementation plan by file

## 15.1 New backend files

1. lib/appConfig.js for boot config parsing and validation.
2. lib/rbacManifest.js for manifest loading/validation/normalization.
3. repositories/workspacesRepository.js.
4. repositories/workspaceMembershipsRepository.js.
5. repositories/workspaceInvitesRepository.js.
6. repositories/workspaceSettingsRepository.js.
7. services/workspaceService.js for selection, provisioning, membership
   checks, and permission resolution.
8. plugins/workspaceContext.js or equivalent extension of plugins/auth.js.

## 15.2 Existing backend files to modify

1. server.js to initialize app config and RBAC loader.
2. plugins/auth.js and/or new workspace plugin registration order.
3. routes/api/index.js to add workspace and permission route metadata.
4. controllers/\* to consume workspace-aware service methods.
5. services/userSettingsService.js to include lastActiveWorkspaceId.
6. services/authService.js to call workspace auto-provision hooks after user
   sync.
7. repositories/calculationLogsRepository.js to scope by workspace_id.
8. repositories/userSettingsRepository.js to support workspace selection
   pointer.
9. shared/auth/authMethods.js integration with role/permission model where
   relevant.

———

## 16) Frontend implementation plan by file

## 16.1 New frontend files

1. src/stores/workspaceStore.js for bootstrapped context and permission
   checks.
2. src/views/WorkspacesView.vue for authenticated/no-workspace chooser page.
3. src/composables/useWorkspaceGuard.js for route-level workspace gating.

## 16.2 Existing frontend files to modify

1. src/main.js to bootstrap before normal app flow.
2. src/router.js to define route classes:
3. public routes (/login, /reset-password),
4. authenticated/no-workspace route (/workspaces),
5. workspace-required routes (/w/:workspaceSlug/...).
6. src/services/api.js to add bootstrap, workspaces, selectWorkspace, invites/
   members APIs.
7. src/App.vue to show/hide switcher and team controls using workspace store.
8. src/views/SettingsView.vue to split user settings vs workspace settings
   panels and permission gates.
9. src/stores/authStore.js to coordinate with workspace bootstrap state.

———

## 17) Boot sequence and routing state machine

1. App startup calls GET /api/bootstrap.
2. If unauthenticated, route to /login.
3. If authenticated and activeWorkspace == null, route to /workspaces.
4. If authenticated and active workspace exists, route to workspace app (/
   w/:slug/...).
5. Any workspace route change should refresh/validate active workspace context
   if slug changes.
6. On workspace selection action, call POST /api/workspaces/select, update
   store, navigate.
7. User settings are applied globally at boot so theme/locale/defaults are not
   delayed until settings page.

———

## 18) Workspace slug sourcing and lifecycle

1. Store slug in workspaces.slug.
2. Generate at workspace creation from workspace name with uniqueness suffix.
3. Keep slug immutable by default in v1 to simplify URLs and cache.
4. Use slug in UI and routes.
5. Resolve slug to workspace_id server-side for all authorization decisions.

———

## 19) Path-mode now, subdomain later plan

1. Implement workspace resolver interface now.
2. Implement current resolver in path mode and explicit select mode.
3. Add host resolver later for subdomain support.
4. Keep domain data untouched because it keys off workspace_id.
5. Preserve /w/:slug fallback for local dev and migration.
6. Prepare infrastructure later with wildcard DNS and wildcard TLS.
7. Keep OAuth callback strategy compatible with variable origins by using
   central callback and post-auth redirect.

———

## 20) Permission checks and invariants

1. No workspace-required endpoint executes without resolved active workspace.
2. No protected endpoint executes without required permission.
3. Last owner cannot be removed/demoted.
4. Non-assignable roles cannot be assigned via invite/member update APIs.
5. Invites fail closed if RBAC manifest invalid or collaboration disabled.
6. Membership status must be active to grant permissions.
7. workspace_id query scoping is mandatory for tenant data access.

———

## 21) Migration plan in strict execution order

1. Add workspaces table migration.
2. Add workspace_memberships table migration.
3. Add workspace_settings table migration.
4. Add workspace_invites table migration.
5. Add last_active_workspace_id to user_settings.
6. Add workspace_id to calculation_logs as nullable initially.
7. Backfill one personal workspace per existing user.
8. Backfill owner membership for each personal workspace.
9. Backfill workspace_settings defaults.
10. Backfill calculation_logs.workspace_id from existing user_id to personal
    workspace mapping.
11. Set calculation_logs.workspace_id to NOT NULL.
12. Add FK and indexes for calculation_logs.workspace_id.
13. Add any composite uniqueness/indexes needed for tenant scope.
14. Merge/sequence current in-flight migration
    migrations/20260217090000_add_password_sign_in_enabled_to_user_settings.cjs
    without conflict.
15. Add rollback-safe down migrations in reverse order.

———

## 22) Suggested migration filenames

1. migrations/20260217xxxx00_create_workspaces.cjs
2. migrations/20260217xxxx10_create_workspace_memberships.cjs
3. migrations/20260217xxxx20_create_workspace_settings.cjs
4. migrations/20260217xxxx30_create_workspace_invites.cjs
5. migrations/20260217xxxx40_add_last_active_workspace_id_to_user_settings.cjs
6. migrations/20260217xxxx50_add_workspace_id_to_calculation_logs.cjs
7. migrations/20260217xxxx60_backfill_personal_workspaces_and_workspace_ids.cj
   s

———

## 23) Detailed behavior for empty permissions manifest

1. App starts with RBAC in “disabled collaboration” mode.
2. Effective role set exposed to runtime includes internal owner only for
   safety.
3. invitesEnabled evaluates false regardless of workspace setting.
4. Member/invite admin APIs return 404 or 403 by policy.
5. Permissions UI and team-management UI are hidden.
6. Workspace still works for personal ownership and data isolation.

———

## 24) UX details for the workspace chooser page (/workspaces)

1. Header text should explicitly confirm authentication success.
2. Body should clearly state whether user has 0, 1, or many workspaces.
3. Workspace cards should show workspace name, slug, role.
4. Primary action is “Open workspace”.
5. If no workspace and creation allowed, show “Create personal workspace”.
6. If no workspace and creation not allowed, show “Await invite / contact
   admin”.
7. If single membership and auto-redirect occurs, allow short delay or
   immediate redirect.
8. Keep this page lightweight and independent from workspace-scoped data.

———

## 25) Loading user settings at app load (your explicit requirement)

1. Move “first application of settings” from settings page to bootstrap flow.
2. Use userSettings returned by /api/bootstrap.
3. Apply theme in src/main.js or workspace store initialization.
4. Apply pagination/default calculator settings globally once.
5. Keep settings page as editor, not loader of first truth.

———

## 26) Existing-code awareness and conflict notes for next session

1. Current working tree has ongoing changes in auth/settings/routes/UI.
2. Existing modified files include controllers/authController.js, controllers/
   settingsController.js, routes/api/index.js, services/authService.js,
   services/userSettingsService.js, repositories/userSettingsRepository.js,
   src/services/api.js, src/views/LoginView.vue, src/views/SettingsView.vue.
3. New untracked files already present include src/utils/oauthCallback.js,
   shared/auth/authMethods.js,
   migrations/20260217090000_add_password_sign_in_enabled_to_user_settings.cjs
   .
4. Next session must integrate with this in-flight work and avoid destructive
   reverts.

———

## 27) Operational and security essentials

1. Keep CSRF behavior unchanged for unsafe methods.
2. Keep auth cookie handling unchanged unless subdomain mode is enabled later.
3. Log workspace resolution decisions at debug level with redaction.
4. Audit log critical actions: workspace select, role changes, invite create/
   revoke, ownership transfer.
5. Add rate limits to invite and membership mutation endpoints.
6. Add consistent error envelope for permission denials and workspace
   mismatch.

———

## 28) Delivery phases and acceptance criteria

## Phase 1: Config and RBAC foundation

1. Build app config loader and RBAC manifest parser.
2. Validate manifest invariants.
3. Acceptance: app boots with valid config; empty manifest disables
   collaboration safely.

## Phase 2: Schema and backfill

1. Add workspace tables and tenant columns.
2. Backfill personal workspaces and workspace_id.
3. Acceptance: existing users/logs operate without data loss.

## Phase 3: Workspace context middleware

1. Resolve active workspace and membership per request.
2. Attach permission set to request.
3. Acceptance: protected workspace endpoints fail closed when workspace/
   permissions missing.

## Phase 4: API and repository scoping

1. Add /api/bootstrap, workspace list/select endpoints.
2. Scope repository queries by workspace_id.
3. Acceptance: cross-workspace data leakage impossible through API.

## Phase 5: Frontend bootstrap and routing

1. Add workspace store and startup bootstrap flow.
2. Add /workspaces authenticated/no-workspace view.
3. Acceptance: auth/no-workspace/workspace-required route states behave
   correctly.
4. Acceptance: user theme is applied before first meaningful app render (not
   only after visiting Settings).
5. Acceptance: top-right app-shell avatar is hydrated from bootstrap profile
   data and appears without visiting Settings first.

## Phase 6: Collaboration APIs and UI gates

1. Add invites/members endpoints and permissions UI.
2. Gate all team controls by effective features and permissions.
3. Acceptance: invites and role UI disappear when manifest empty or invites
   disabled.

## Phase 7: Multi-workspace UX and polish

1. Add workspace switcher and last-active persistence.
2. Add workspace creation flow if policy allows.
3. Acceptance: smooth switching with correct settings/permissions refresh.

## Phase 8: Subdomain readiness hooks

1. Finalize resolver abstraction for host mode.
2. Keep path fallback.
3. Acceptance: no domain model changes required to turn on subdomain mode
   later.

———

## 29) Product decisions still to lock

1. Should defaultInviteRole be app-global only, or overridable per workspace?
2. Should workspace creation be allowed for every user in multi-workspace, or
   permission-gated?
3. Should role definitions remain manifest-only in v1, or allow workspace-
   local custom roles later?
4. Should /api/bootstrap include CSRF token, or keep CSRF only on /api/
   session?
5. Should workspace slug be mutable with redirects, or immutable in v1?
6. Should owner transfer be supported in v1?

———

## 30) Concrete handoff instruction block for next session

Implement the workspace-native scaffold plan with personal-mode default.

Hard requirements:

1. Preserve current layered architecture (routes/controllers/services/
   repositories).
2. Add 3-layer config model: app config (boot/env), workspace config (DB),
   user config (DB).
3. Introduce workspace primitives: workspaces, memberships, invites,
   workspace_settings.
4. Add workspace_id to workspace-owned domain records (start with
   calculation_logs).
5. Implement RBAC manifest loader and permission resolver.
6. Enforce collaboration => authorization coupling:
   - if manifest empty/invalid: invites OFF, permissions UI OFF.
7. Add /api/bootstrap returning session + active workspace (nullable) +
   permissions + user/workspace settings + safe app flags.
8. Add authenticated/no-workspace page (/workspaces) with 0/1/N workspace
   behaviors.
9. In personal mode, auto-provision personal workspace and auto-select it.
10. Load user settings at app startup via bootstrap, not only in settings
    page.
11. Keep future compatibility for slug.example.com by resolver abstraction;
    keep /w/:slug path mode now.
12. Avoid destructive git operations; integrate with current in-progress
    files.

———

## 31) Commit-Sized, Line-Mapped Execution Backlog (Current HEAD)

Use this section as the execution script for the next session. Line numbers
below are anchored to the current files as they exist now and will drift as
commits are applied.

### Global Execution Rules

1. Do not run tests in this branch unless explicitly asked.
2. Keep commits small and mechanical; one behavior change per commit.
3. Preserve route/service/repository layer boundaries.
4. Maintain backwards compatibility where possible (`/api/session`,
   `/api/history`, `/api/annuityCalculator`).
5. Prefer additive migrations and compatibility shims before deletions.
6. For every commit, include a short migration/rollback note in commit body.

### Commit 01: Boot Config + RBAC Loader Wiring

Goal: introduce app boot config and RBAC manifest validation without changing
runtime behavior yet.

Files and line anchors:

1. `server.js:1-33`
   - Add imports for new modules:
     - `lib/appConfig.js`
     - `lib/rbacManifest.js`
   - Keep import order grouped (node -> deps -> local).
2. `server.js:45-51`
   - Replace/augment env-derived constants with a single resolved app config
     object (`APP_CONFIG`).
   - Keep `NODE_ENV`, `PORT` derived from `APP_CONFIG`.
3. `server.js:92-123`
   - Extend `validateRuntimeConfig()` to include:
     - tenancy mode validation
     - RBAC manifest path validation
     - public app config sanitization constraints
4. `server.js:279-360`
   - Add `app.decorate("appConfig", APP_CONFIG_PUBLIC)` in `buildServer`.
   - Keep swagger/static/plugin registration order unchanged.
5. `server.js:405-433`
   - Ensure startup fails fast if RBAC manifest is invalid.

Supporting new files:

1. `lib/appConfig.js`
   - Parse env into typed config:
     - `tenancyMode`
     - `workspaceSwitchingDefault`
     - `workspaceInvitesDefault`
     - `maxWorkspacesPerUser`
     - `rbacManifestPath`
2. `lib/rbacManifest.js`
   - Load JSON, validate invariants:
     - system `owner` exists and non-assignable
     - valid permission arrays
     - valid `defaultInviteRole` when invites enabled

Commit done when:

1. Server boot path has config object wired.
2. Invalid manifest causes deterministic startup error.
3. No route behavior changed yet.

### Commit 02: Workspace Schema Migrations + Backfill

Goal: add workspace primitives and backfill personal workspaces.

Files:

1. New migration files (ordered):
   - `migrations/*_create_workspaces.cjs`
   - `migrations/*_create_workspace_memberships.cjs`
   - `migrations/*_create_workspace_settings.cjs`
   - `migrations/*_create_workspace_invites.cjs`
   - `migrations/*_add_last_active_workspace_id_to_user_settings.cjs`
   - `migrations/*_add_workspace_id_to_calculation_logs.cjs`
   - `migrations/*_backfill_personal_workspaces.cjs`
2. Keep existing in-flight migration:
   - `migrations/20260217090000_add_password_sign_in_enabled_to_user_settings.cjs`
   - Do not reorder existing migration IDs; append newer timestamps.

Required DB behavior:

1. One personal workspace per existing user profile.
2. One owner membership per created personal workspace.
3. `calculation_logs.workspace_id` backfilled from user mapping.
4. `user_settings.last_active_workspace_id` set for existing users.

Commit done when:

1. Schema supports workspaces without breaking current tables.
2. Backfill logic is idempotent and safe on retries.

### Commit 03: Repository Layer - Add Workspace Repositories + Tenant Scoping

Goal: introduce workspace repositories and scope existing domain queries by
`workspace_id`.

Files and line anchors:

1. `repositories/calculationLogsRepository.js:37-79`
   - Change signatures to require `workspaceId`:
     - `insert(workspaceId, userId, entry)`
     - `countForWorkspace(workspaceId)`
     - `listForWorkspace(workspaceId, page, pageSize)`
   - Keep mapper unchanged.
2. `repositories/calculationLogsRepository.js:90`
   - Export new names; keep compatibility aliases only if needed for staged
     rollout.
3. `repositories/userSettingsRepository.js:17-36`
   - Add `lastActiveWorkspaceId` to mapped output.
4. `repositories/userSettingsRepository.js:47-85`
   - Extend patch builder to include `lastActiveWorkspaceId`.
5. `repositories/userSettingsRepository.js:110-188`
   - Add methods:
     - `findByUserIdForUpdate` (optional transaction helper)
     - `updateLastActiveWorkspaceId(userId, workspaceId)`
6. `repositories/userProfilesRepository.js:61-169`
   - Add helper `findById(userId)` for workspace bootstrap flows.

New repository files:

1. `repositories/workspacesRepository.js`
2. `repositories/workspaceMembershipsRepository.js`
3. `repositories/workspaceSettingsRepository.js`
4. `repositories/workspaceInvitesRepository.js`

Required functions:

1. Resolve workspace by slug/id.
2. List memberships for user.
3. Ensure personal workspace exists.
4. Read/update workspace settings.
5. Create/list/revoke invites.

Commit done when:

1. Existing repositories compile with new exports.
2. Workspace repositories exist with strict row mappers.

### Commit 04: Auth Plugin - Add Workspace Context and Permission Enforcement

Goal: resolve active workspace and enforce per-route permission keys.

Files and line anchors:

1. `plugins/auth.js:52`
   - Add request decorations:
     - `workspace`
     - `membership`
     - `permissions`
2. `plugins/auth.js:72-75`
   - Read new route config fields:
     - `workspacePolicy` (`none|required|optional`)
     - `permission`
     - `allowNoWorkspace`
3. `plugins/auth.js:84-101`
   - After auth succeeds, call `workspaceService.resolveRequestContext(...)`.
   - Set `request.workspace`, `request.membership`, `request.permissions`.
4. `plugins/auth.js:102-122`
   - Preserve existing `required/own` logic.
   - Add permission check helper:
     - wildcard owner support (`*`)
     - named permission check
   - Return 403 with consistent message if permission missing.
5. `plugins/auth.js:66-70`
   - Keep non-API route bypass as-is.

Supporting service:

1. New `services/workspaceService.js` used by plugin.

Commit done when:

1. Requests can be authenticated with or without active workspace depending
   on route policy.
2. Permission gate can be applied route-by-route.

### Commit 05: Route Contracts - Bootstrap + Workspaces + Permission Metadata

Goal: expose bootstrap and workspace endpoints; add route-level permission and
workspace policy metadata.

Files and line anchors:

1. `routes/api/index.js:256-275`
   - Add bootstrap response schema (`session`, `app`, `workspaces`,
     `activeWorkspace`, `permissions`, `userSettings`, `workspaceSettings`).
2. `routes/api/index.js:391-513`
   - Add workspace schema objects:
     - workspace summary
     - membership summary
     - workspace settings
3. `routes/api/index.js:567-787`
   - Insert new routes before `/api/settings`:
     - `GET /api/bootstrap`
     - `GET /api/workspaces`
     - `POST /api/workspaces/select`
     - `POST /api/workspaces` (optional profile-dependent)
4. `routes/api/index.js:788-1022`
   - Add `workspacePolicy` + `permission` to existing workspace-owned routes:
     - `/api/history` -> `workspacePolicy: "required"`, permission
       `history.read`
     - `/api/annuityCalculator` -> `workspacePolicy: "required"`, permission
       `history.write`
     - workspace settings routes -> appropriate `workspace.settings.*` perms
5. `routes/api/index.js:1026-1041`
   - Extend route config payload:
     - `workspacePolicy`
     - `permission`
     - `allowNoWorkspace`
6. `routes/api/index.js:1042-1044`
   - Keep handler invocation shape intact.

Commit done when:

1. Route definitions can express workspace + permission requirements.
2. Bootstrap/workspace APIs are declared with TypeBox schemas.

### Commit 06: Server Wiring - Services and Controllers for Workspace Flows

Goal: connect new workspace services/controllers into server bootstrap.

Files and line anchors:

1. `server.js:14-30`
   - Import workspace repositories/services/controllers.
2. `server.js:52-90`
   - Instantiate `workspaceService` with:
     - app config
     - RBAC manifest
     - workspace repositories
     - user settings repository
3. `server.js:85-90`
   - Extend `controllers` object with `workspace` controller.
4. `server.js:333`
   - Register auth plugin with `workspaceService` option.
5. `server.js:357`
   - Keep `registerApiRoutes` call; pass new controllers.
6. `server.js:125-181` and `server.js:260-277`
   - Update page guard logic:
     - allow `/workspaces` as authenticated-no-workspace page
     - redirect unauthenticated users to `/login`
     - redirect authenticated/no-workspace users to `/workspaces`

Commit done when:

1. App boot has all workspace dependencies wired.
2. Page guard distinguishes authenticated/no-workspace state.

### Commit 07: Repository Consumer Refactor in Service Layer (Tenant IDs)

Goal: ensure services pass `workspaceId` to repositories.

Files impacted outside requested map:

1. `services/annuityHistoryService.js`
2. `services/annuityService` consumers in controllers
3. `controllers/historyController.js`
4. `controllers/annuityController.js`

Repository file anchors to verify:

1. `repositories/calculationLogsRepository.js:38-70`
   - Ensure all call sites now include `workspaceId`.

Commit done when:

1. History write/read paths are workspace-scoped.
2. No service infers workspace from user ID anymore.

### Commit 08: Frontend Startup Bootstrap

Goal: hydrate app + user + workspace context before normal navigation.

Files and line anchors:

1. `src/main.js:1-19`
   - Import new stores/services:
     - workspace store
     - bootstrap API helper
2. `src/main.js:21-24`
   - Create workspace store beside auth store.
3. `src/main.js:35-70`
   - Keep Vuetify theme setup unchanged.
4. `src/main.js:72-78`
   - Convert boot to async init:
     - fetch `/api/bootstrap`
     - hydrate auth store
     - hydrate workspace store
     - apply user theme immediately
   - Mount app only after bootstrap resolution (with graceful fallback).
5. `src/App.vue` (app-shell user menu / avatar section)
   - Bind top-right avatar to hydrated profile avatar URL from bootstrap/store.
   - Keep initials fallback when no avatar is available.
   - Do not require a Settings page fetch to show avatar.

Supporting file:

1. `src/stores/workspaceStore.js` (new)

Known UX issues closed by this commit series:

1. Top-right avatar missing until later navigation:
   fixed by hydrating profile/avatar at startup and wiring app shell to that
   state.
2. Theme only applying after opening Settings:
   fixed by applying user theme directly from bootstrap during app init.

Commit done when:

1. First render has settings/workspace context loaded.
2. No dependency on Settings page for initial theme application.
3. Top-right user avatar appears immediately after login/session restore when
   an avatar exists.

### Commit 09: Router Split - Public vs Auth-No-Workspace vs Workspace-Required

Goal: add workspace chooser route and gate workspace pages.

Files and line anchors:

1. `src/router.js:13-18`
   - Add lazy import for `WorkspacesView`.
2. `src/router.js:21-41`
   - Keep `resolveAuthState` but extend to return `hasActiveWorkspace`.
3. `src/router.js:43-61`
   - Replace current guards with three guards:
     - `beforeLoadPublic`
     - `beforeLoadAuthenticatedNoWorkspace`
     - `beforeLoadWorkspaceRequired`
4. `src/router.js:75-100`
   - Move workspace-required views under `/w/$workspaceSlug` paths:
     - calculator
     - choice2
     - settings
5. `src/router.js:68-74` and `src/router.js:89-93`
   - Keep `/login` and `/reset-password` as public routes.
6. `src/router.js:102`
   - Add `/workspaces` route for authenticated/no-workspace state.
7. `src/router.js:102-109`
   - Update route tree order to include chooser route.

Supporting new file:

1. `src/views/WorkspacesView.vue` (new)

Commit done when:

1. Authenticated user with no active workspace lands on `/workspaces`.
2. Workspace-required routes reject missing workspace context.

### Commit 10: Settings Page Split - User Settings + Workspace Settings + Team Gating

Goal: adapt existing settings screen to separated config layers and
collaboration gates.

Files and line anchors:

1. `src/views/SettingsView.vue:15-20`
   - Add/rename tabs to separate:
     - user preferences
     - workspace settings
     - team/invites (gated)
2. `src/views/SettingsView.vue:23-215`
   - Keep auth method panel in user-security area.
   - Add team panel conditional on:
     - workspace feature `invitesEnabled`
     - permission `workspace.members.view/manage`
3. `src/views/SettingsView.vue:490-527`
   - Import workspace store and new API methods for workspace settings/members
     (without removing existing settings APIs in same commit).
4. `src/views/SettingsView.vue:529-599`
   - Introduce separate query keys:
     - `USER_SETTINGS_QUERY_KEY`
     - `WORKSPACE_SETTINGS_QUERY_KEY`
   - Keep existing `SETTINGS_QUERY_KEY` as compatibility alias until final
     cleanup commit.
5. `src/views/SettingsView.vue:611-629`
   - Keep user preference forms in `preferencesForm`.
   - Add `workspaceForm` for workspace-level config (invites, policies).
6. `src/views/SettingsView.vue:657-715`
   - Add mutations:
     - `updateWorkspaceSettingsMutation`
     - `createInviteMutation`
     - `revokeInviteMutation`
     - `updateMemberRoleMutation`
7. `src/views/SettingsView.vue:717-819`
   - Add computed flags from workspace store:
     - `canManageWorkspaceSettings`
     - `canViewMembers`
     - `canInviteMembers`
8. `src/views/SettingsView.vue:1127-1154`
   - Split `applySettingsData` into:
     - `applyUserSettingsData`
     - `applyWorkspaceSettingsData`
9. `src/views/SettingsView.vue:1274-1337`
   - Keep user-pref submit handlers.
10. `src/views/SettingsView.vue:1339-1466`
    - Keep auth method handlers.
    - Add workspace/team handlers near this block for consistency.
11. `src/views/SettingsView.vue:1485-1489`
    - On mount, hydrate from bootstrap/workspace store first, then fetch stale
      data.

Commit done when:

1. User config and workspace config are visibly separate in UI/state.
2. Team UI appears only when collaboration is enabled and permitted.

### Commit 11: Route and Plugin Hardening for Backward Compatibility

Goal: keep old paths and payloads working while workspace-native paths are
introduced.

Files and line anchors:

1. `routes/api/index.js:990-1022`
   - Keep `/api/history` and `/api/annuityCalculator` stable.
   - Resolve workspace from context internally, not request body.
2. `plugins/auth.js:66-122`
   - Ensure public endpoints remain public.
   - Ensure 503 transient auth behavior preserved.
3. `server.js:362-389`
   - Keep SPA fallback behavior while supporting `/w/:slug/*` and
     `/workspaces`.

Commit done when:

1. Existing clients still function.
2. New workspace behavior is additive.

### Commit 12: Repository Finalization - Remove User-Scoped Tenant Query Paths

Goal: finish repository transition from user-owned to workspace-owned domain
access.

Files and line anchors:

1. `repositories/calculationLogsRepository.js:58-79`
   - Remove/avoid user-only listing APIs for tenant-owned reads.
   - Keep explicit workspace-scoped list/count methods as primary exports.
2. `repositories/userSettingsRepository.js:166-187`
   - Finalize active workspace mutator methods.
3. `repositories/userProfilesRepository.js:61-169`
   - Keep identity profile concerns only; avoid cross-tenant semantics.

Commit done when:

1. No tenant-owned repository query path can execute without `workspace_id`.

### Commit 13: Frontend Workspace Chooser Integration

Goal: wire workspace chooser page into real selection flow and settings fetch.

Files primarily outside requested list:

1. `src/views/WorkspacesView.vue` (new)
2. `src/services/api.js` (new workspace APIs)
3. `src/stores/workspaceStore.js` (selection and hydration)

Required coupling back to requested files:

1. `src/router.js:63-109`
   - Selection route and redirect outcomes.
2. `src/main.js:21-78`
   - Startup bootstrap includes workspace list + active workspace.
3. `src/views/SettingsView.vue:589-599`
   - Read active workspace from store (no local workspace identity source).

Commit done when:

1. User can be authenticated with `activeWorkspace = null`.
2. Selecting a workspace updates context and loads workspace settings.

### Commit 14: Subdomain Readiness Hooks (No Infra Flip Yet)

Goal: add host-based workspace resolver hooks while keeping path mode default.

Files and line anchors:

1. `plugins/auth.js:66-72`
   - Route config and request context include resolver source metadata.
2. `server.js:125-181`
   - Use resolver abstraction in page guard.
3. `routes/api/index.js:1026-1041`
   - Add optional route flag to allow host/path workspace selection behavior
     where needed.
4. `src/router.js`
   - Keep `/w/:workspaceSlug` as canonical client route for now.

Commit done when:

1. Backend can resolve workspace from path now and host later via one service.
2. No data model changes are needed for future `slug.example.com`.

### File-by-File Literal Checklist (Requested Files)

#### `server.js`

1. `1-30`: import app config, RBAC loader, workspace service/controller.
2. `45-51`: replace scattered constants with resolved `APP_CONFIG`.
3. `52-90`: instantiate workspace service and add workspace controller to
   `controllers`.
4. `92-123`: validate tenancy + manifest in `validateRuntimeConfig()`.
5. `279-303`: decorate app with public config metadata.
6. `333`: pass workspace service into auth plugin registration.
7. `357`: register routes with workspace-aware controllers.
8. `125-181`, `260-277`: page guard logic for `/workspaces` and
   authenticated/no-workspace redirect.

#### `routes/api/index.js`

1. `256-275`: add bootstrap response schemas.
2. `391-513`: add workspace/membership/settings schemas.
3. `567-787`: add `/api/bootstrap`, `/api/workspaces`, `/api/workspaces/select`.
4. `788-1022`: tag workspace-owned endpoints with `workspacePolicy` and
   `permission`.
5. `1026-1041`: include new route config fields in `fastify.route({ config })`.

#### `plugins/auth.js`

1. `52`: add request decorations for workspace context and permissions.
2. `72-75`: parse new route config flags.
3. `84-101`: resolve workspace context after auth.
4. `102-122`: enforce permission checks and workspace policy.

#### `repositories/*`

1. `repositories/calculationLogsRepository.js:37-79`:
   workspace-scoped insert/count/list.
2. `repositories/userSettingsRepository.js:17-36`:
   map `lastActiveWorkspaceId`.
3. `repositories/userSettingsRepository.js:166-187`:
   add `updateLastActiveWorkspaceId`.
4. `repositories/userProfilesRepository.js:61-169`:
   add `findById` helper for workspace bootstrapping.
5. Add new files:
   - `repositories/workspacesRepository.js`
   - `repositories/workspaceMembershipsRepository.js`
   - `repositories/workspaceSettingsRepository.js`
   - `repositories/workspaceInvitesRepository.js`

#### `src/router.js`

1. `13-18`: add `WorkspacesView` lazy import.
2. `21-61`: split guards into auth-only and workspace-required guards.
3. `63-109`: add `/workspaces`; move app routes to `/w/$workspaceSlug/*`.

#### `src/main.js`

1. `1-19`: import workspace store/bootstrap utilities.
2. `21-24`: instantiate workspace store.
3. `72-78`: convert mount flow into async bootstrap then mount.

#### `src/App.vue` (supporting file for hydration outcomes)

1. User menu/avatar block: consume hydrated avatar URL from store/bootstrap.
2. Keep initials fallback logic.
3. Ensure avatar no longer depends on Settings view lifecycle.

#### `src/views/SettingsView.vue`

1. `15-20`: tab model split between user/workspace/team concerns.
2. `23-215`: gate team controls by workspace feature + permission.
3. `490-527`: import workspace store and workspace/team APIs.
4. `529-715`: add workspace query keys and workspace/team mutations.
5. `717-819`: add permission-derived computed guards.
6. `1127-1154`: split apply helpers into user vs workspace.
7. `1274-1466`: keep user/security handlers; add workspace/team handlers.
8. `1485-1489`: boot from workspace-aware context, not settings-only fetch.

### Suggested Commit Order (exact)

1. Commit 01 Boot config + manifest loader.
2. Commit 02 Workspace schema migrations + backfill.
3. Commit 03 Repository additions + tenant scoping.
4. Commit 04 Plugin workspace context + permission checks.
5. Commit 05 API schemas/routes for bootstrap and workspace ops.
6. Commit 06 Server wiring + page guard updates.
7. Commit 07 Service/controller adaptation to `workspace_id`.
8. Commit 08 Frontend bootstrap in `src/main.js`.
9. Commit 09 Router split + `/workspaces`.
10. Commit 10 Settings UI/state split and team gating.
11. Commit 11 Backward-compat hardening.
12. Commit 12 Repository final cleanup and alias removal (if safe).
13. Commit 13 Workspace chooser integration end-to-end.
14. Commit 14 Subdomain readiness hooks (no infra switch).

———

## 32) Locked Architecture Decision: Two Full Surfaces per Workspace (`admin` + `app`)

This is now a locked design direction and should be treated as a major
(program-level) refactor, not a small incremental tweak.

### 32.1 Decision summary

1. Each workspace (`tenant`) has at least two full app surfaces:
   - `admin` surface for owners/staff (workspace management, invites, roles,
     configuration, slots).
   - `app` surface for end customers/consumers (booking journey).
2. `book` is a future rename/alias of `app` if an adopter prefers that label.
3. Surfaces are first-class and generic; more may be added later (`kiosk`,
   `portal`, etc.), but `admin` + `app` are the scaffold defaults.

### 32.2 URL and routing model

1. Preferred subdomain pattern:
   - `admin.{workspace}.example.com`
   - `app.{workspace}.example.com`
2. Path fallback pattern:
   - `example.com/{workspace}/admin/...`
   - `example.com/{workspace}/app/...`
3. Keep both resolvers abstracted in backend so either pattern can be enabled
   by environment/infra policy.

### 32.3 Deployment and entrypoints

1. `admin` and `app` must have separate frontend entrypoints (`index.html`
   - `main.js`) and separate bundles.
2. They can share the same monorepo/codebase and shared libraries.
3. They may be deployed on separate servers/load balancers/CDNs.
4. Backend domain logic can still be shared; physical backend split is
   optional and can be phased later.

### 32.4 Security and auth boundary requirements

1. No shared session between `admin` and `app` surfaces.
2. Separate auth audiences/cookie namespaces/token claims for each surface.
3. Separate API namespaces and policy walls:
   - `/api/admin/*`
   - `/api/app/*`
4. Customer (`app`) surface must never expose staff/invite/role operations.
5. Staff RBAC model remains only for `admin` surface.
6. Customer authz exists even without role UI (for example: own bookings only).

### 32.5 Multi-home semantics with two surfaces

1. Workspace remains the tenancy boundary (`workspace_id` on domain data).
2. `admin` users are workspace staff members with roles/permissions.
3. `app` users are customer actors; do not model them as staff memberships.
4. Customer can still belong to multiple workspaces:
   - direct deep links enter a specific workspace surface.
   - optional global customer hub may list all available workspace contexts.

### 32.6 Why this is a HUGE MEGA refactor

1. Frontend build system changes from one SPA entrypoint to multi-entry
   surfaces.
2. Routing model changes from single app routes to surface + workspace aware
   routes.
3. API surface splits into two policy domains (`admin` and `app`).
4. Auth/session model splits by surface and audience.
5. Bootstrapping and config hydration become surface-specific.
6. Operational deployment model needs explicit surface rollout strategy.

### 32.7 Additional commit track required (after Commit 14)

#### Commit 15: Multi-entry frontend scaffolding (`admin` + `app`)

Use:

1. `src/main.admin.js`
2. `src/main.app.js`

Same architecture, less nesting.

1. Add separate HTML entry files:
   - `apps/admin/index.html`
   - `apps/app/index.html`
2. Add separate mains:
   - `src/main.admin.js`
   - `src/main.app.js`
3. Keep these files thin composition roots only (router/bootstrap/auth
   context); do not duplicate shared feature/domain/UI modules.
4. Move current `src/main.js` logic into `admin` surface bootstrap, then
   create `app` surface bootstrap with customer context flow.
5. Update Vite config/build outputs for multi-entry bundles.

#### Commit 16: Surface-specific routers

1. Add surface routers:
   - `src/router.admin.js`
   - `src/router.app.js`
2. Keep `admin` routes workspace+permission aware.
3. Keep `app` routes customer-flow only (no staff pages or staff tabs).

#### Commit 17: API namespace split with shared core service

1. Add namespace route registration:
   - `routes/adminApiRoutes.js`
   - `routes/appApiRoutes.js`
2. Keep shared business logic in services/repositories.
3. Register namespaces from `server.js` with explicit surface policy config.

#### Commit 18: Surface-aware auth middleware

1. Extend `plugins/auth.js` (or split plugin) so each namespace enforces the
   correct auth audience and session cookie names.
2. Enforce admin-only permissions on `/api/admin/*`.
3. Enforce customer actor policy on `/api/app/*`.

#### Commit 19: Surface-aware bootstrap contracts

1. `/api/admin/bootstrap` returns staff+workspace context.
2. `/api/app/bootstrap` returns customer+workspace context.
3. Keep shared config semantics but return only surface-relevant capabilities.

#### Commit 20: URL resolution and host mapping

1. Extend workspace resolver to parse both `surface` and `workspace` from:
   - host style (`admin.{workspace}.example.com`)
   - path style (`/{workspace}/admin/...`)
2. Add strict invalid-surface handling (404, no fallback to staff routes).

#### Commit 21: Admin/App UX hard separation

1. Ensure app shell (`src/App.vue` or split shells) does not leak staff menu
   items to `app` surface.
2. Ensure `app` surface has no invites/roles/settings-admin affordances.
3. Keep customer-facing booking-only affordances.

#### Commit 22: Deployment profile and docs

1. Document single-backend and split-backend deployment options.
2. Document cookie/CORS/CSP requirements per surface.
3. Document DNS/TLS mapping for:
   - `admin.{workspace}.example.com`
   - `app.{workspace}.example.com`

### 32.8 File-level impact addendum (critical)

1. `server.js`:
   - Register surface-specific route trees and host/path surface resolver.
2. `routes/api/index.js`:
   - Either split into `adminApiRoutes.js` and `appApiRoutes.js`, or preserve
     this file as shared schema module plus two registrars.
3. `plugins/auth.js`:
   - Add surface/audience/session discrimination.
4. `src/main.admin.js` + `src/main.app.js` (or `src/main.js` thin delegator):
   - Hold surface-specific bootstrap with shared runtime setup.
5. `src/router.js`:
   - Split into per-surface routers or becomes admin router only.
6. `src/views/SettingsView.vue`:
   - Admin surface only; never mounted in `app` surface.

### 32.9 Non-negotiable acceptance criteria for two-surface model

1. `admin` and `app` build artifacts are separate.
2. `admin` and `app` auth contexts are separate.
3. `app` surface cannot invoke or access staff endpoints.
4. Workspace resolution works with surface + tenant in both host and path
   modes.
5. Shared business logic remains single-source to avoid rule drift.

---

## 33) Workspace-Scoped Login and Shared Identity Clarification

This section captures the final clarification from the latest discussion.

### 33.1 Core rule: login is authentication, not authorization

1. There is one identity login concept (user authenticates once as a person).
2. `admin` vs `app` access is authorization, derived after login from
   memberships/roles/capabilities in the target workspace and surface.
3. A user can be:
   - staff/admin in workspace A (`admin` surface access),
   - customer-only in workspace B (`app` surface access),
   - both in different workspaces without account duplication.

### 33.2 Workspace-aware login entry is required

1. Login must work both globally and in-workspace:
   - global: `example.com/login`
   - workspace+surface: `admin.{workspace}.example.com/login`,
     `app.{workspace}.example.com/login`,
     `example.com/{workspace}/admin/login`,
     `example.com/{workspace}/app/login`
2. If login starts from workspace+surface URL, preserve intended destination
   (`surface`, `workspaceSlug`, optional `next`) through auth flow.
3. On success, redirect directly back into that exact workspace+surface when
   authorized.

### 33.3 Post-login resolution behavior

1. If target workspace+surface was explicit:
   - allowed -> redirect there directly.
   - not allowed -> show surface-safe access denied/alternate flow (never
     silent elevation).
2. If login was global (no explicit workspace target):
   - 0 accessible contexts -> show authenticated no-context page.
   - 1 accessible context -> auto-redirect to that context.
   - N contexts -> show chooser page.
3. Chooser must be surface-aware: selecting an `admin` context is distinct
   from selecting an `app` context.

### 33.4 Interaction with single-workspace mode

1. Single-workspace mode remains a policy preset, not a different architecture.
2. For staff/admin scenario:
   - auto-provision one workspace where relevant.
   - auto-select it and skip chooser unless ambiguity exists.
3. For customer scenario:
   - customer still resolves to workspace context for all domain data.
   - if exactly one customer context exists, direct-redirect is valid.

### 33.5 Security requirements for login flow

1. Preserve strict separation of `admin` and `app` sessions/cookies/audiences.
2. Never grant `admin` capabilities because user is authenticated.
3. Always evaluate authorization against `workspace_id` and surface policy.
4. Keep explicit denial paths and auditable logs for unauthorized surface
   attempts.

### 33.6 Concrete file-level task addendum (next-session checklist)

1. `server.js`
   - Ensure login route handling preserves optional target context
     (`surface`, `workspaceSlug`, `next`) for SPA bootstrap consumption.
   - Ensure surface+workspace resolver runs before authz checks.
2. `routes/api/index.js`
   - Extend auth/bootstrap contracts to include requested context and resolved
     accessible contexts.
   - Ensure login response (or follow-up bootstrap) provides deterministic
     redirect decision inputs.
3. `plugins/auth.js`
   - Authenticate identity first, then compute per-surface/workspace authz
     context.
   - Attach resolved context to request for downstream policy checks.
4. `repositories/*`
   - Add/confirm queries for user memberships by workspace and by surface
     capability.
   - Add helper queries for "all accessible contexts for user".
5. `src/router.js`
   - Support workspace-scoped login route variants and post-login destination
     restoration.
   - Keep guards split between auth-required and workspace+surface-required.
6. `src/main.js`
   - Read preserved login target context before initial redirect decisions.
   - Use bootstrap context to route: direct target, chooser, or no-context
     page.
7. `src/views/SettingsView.vue`
   - Keep as admin-surface only.
   - Do not expose in customer `app` route graph.

### 33.7 Acceptance criteria (login clarification)

1. Visiting `admin.{workspace}.example.com/login` and authenticating as
   authorized staff lands directly in that workspace admin surface.
2. Visiting `app.{workspace}.example.com/login` and authenticating as customer
   lands directly in that workspace app surface.
3. Authenticated users without access to requested surface never receive
   elevated access; they see explicit fallback/denied flow.
4. Global login still supports 0/1/N context outcomes deterministically.
