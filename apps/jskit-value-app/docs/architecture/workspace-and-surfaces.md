# Workspace and Surface Architecture

Last consolidated: 2026-02-24 (UTC)

This document replaces the previous `multihome.md` transcript with a decision record and execution backlog.

## Target Outcomes

1. One scaffold architecture supports solo mode on day one.
2. The same architecture upgrades to team and multi-workspace without schema rewrites.
3. Collaboration stays permission-backed (`membership != full access`).

## Core Invariants

1. `workspace_id` is mandatory on workspace-owned domain records.
2. Collaboration features require a valid RBAC manifest.
3. App config is operator-owned and loaded at boot.
4. Workspace config is workspace-admin owned and persisted per workspace.
5. User config is user-owned and persisted per user.
6. `/api/v1/bootstrap` is the first-load runtime context contract.

## Mode Profiles

| Profile | Workspaces/User | Invites | Workspace Switcher | Typical Use |
| --- | ---: | ---: | ---: | --- |
| `personal` (default) | 1 | Off | Off | Solo app |
| `team-single` | 1 | On | Off | One team workspace |
| `multi-workspace` | N | On | On | Agencies/SaaS/orgs |

## Configuration Model

Layer model:

1. App config from env/static manifests (`server.js` boot-time load).
2. Workspace config from DB (`workspace_settings` keyed by `workspace_id`).
3. User config from DB (`user_settings` keyed by `user_id`).

Effective precedence:

1. Start from app defaults/hard caps.
2. Overlay active-workspace config.
3. Overlay user presentation preferences.
4. User config cannot bypass workspace policy.
5. Workspace config cannot bypass app hard limits.

## RBAC and Collaboration Contract

1. Manifest must include non-assignable owner role.
2. Invites require at least one assignable non-owner role.
3. Invalid/empty RBAC manifest disables invites and role-management UI.
4. Backend enforces these invariants regardless of UI.

Reference manifest shape:

```json
{
  "version": 1,
  "defaultInviteRole": "member",
  "roles": {
    "owner": { "assignable": false, "permissions": ["*"] },
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
      "permissions": ["history.read", "history.write"]
    }
  }
}
```

## Data Model Baseline

Primary tables and fields:

- `workspaces`: `id`, `slug`, `name`, `owner_user_id`, `is_personal`, timestamps.
- `workspace_memberships`: `workspace_id`, `user_id`, `role_id`, `status`, timestamps.
- `workspace_invites`: `workspace_id`, `email`, `role_id`, `token`, `invited_by_user_id`, `expires_at`, `status`.
- `workspace_settings`: `workspace_id` plus policy/features fields.
- `user_settings`: includes `last_active_workspace_id`.
- Workspace-owned domain tables: include `workspace_id` (starting with `calculation_logs`).

## Workspace Resolution and Selection

Resolution rules:

1. If URL/host specifies workspace, use it if membership is valid.
2. Else use `user_settings.last_active_workspace_id` if still valid.
3. Else auto-select when membership count is exactly one.
4. Else return authenticated/no-active-workspace state.

Policy:

- Slug is route identity.
- Authorization always resolves and checks `workspace_id`.

## `/api/v1/bootstrap` Contract

Purpose:

- Single startup payload for session, app config, workspace context, permissions, and settings.

Expected fields:

- `session`
- `app`
- `workspaces[]`
- `activeWorkspace` (nullable)
- `membership` (nullable)
- `permissions`
- `workspaceSettings` (nullable)
- `userSettings`

Null-active behavior:

- `session.authenticated = true`
- `activeWorkspace = null`
- `membership = null`
- `permissions = []`
- `workspaceSettings = null`

## Authenticated No-Workspace Route

`/workspaces` is required for authenticated users with `activeWorkspace = null`.

Expected UX:

1. `0` memberships: empty state (`create workspace` or `request invite`).
2. `1` membership: auto-select and redirect.
3. `N` memberships: explicit chooser.

Personal mode still keeps this route as fallback for migration/inconsistent states.

## Routing Strategy

Current:

- Path mode: `/w/:workspaceSlug/...`

Future-ready:

- Host mode: `:slug.example.com`
- Keep one resolver interface so path and host modes share service/repository logic.

## Locked Surface Decision (`admin` + `app`)

Each workspace owns at least two surfaces:

- `admin`: staff/owner operations.
- `app`: customer/end-user operations.

Boundary requirements:

1. Separate auth contexts (cookies/audiences/tokens) for `admin` and `app`.
2. Separate API namespaces (`/api/v1/admin/*`, `/api/v1/app/*`).
3. `app` surface must not expose staff role/invite/settings-admin actions.
4. Shared business logic should remain single-source in services/repositories.
5. Action runtime and assistant tool catalogs must be surface-scoped so non-target-surface actions are not exposed to the model/tool list.

## Login Clarification

1. Login authenticates identity; authorization is computed per workspace+surface.
2. Workspace-scoped login entry must preserve intended `{ surface, workspaceSlug, next }` target.
3. Post-login routing:
   - explicit target + authorized -> direct redirect,
   - explicit target + unauthorized -> explicit denied/fallback,
   - global login + 0/1/N contexts -> no-context/auto-redirect/chooser.

## Execution Backlog

Workspace-native track:

1. Boot config + RBAC loader.
2. Workspace schema and backfills.
3. Repository tenant scoping by `workspace_id`.
4. Auth plugin workspace context + permission checks.
5. `/api/v1/bootstrap`, `/api/v1/workspaces`, `/api/v1/workspaces/select` contracts.
6. Server wiring and page guards for no-workspace state.
7. Service/controller refactor to pass `workspaceId` explicitly.
8. Frontend bootstrap hydration in `src/main.js`.
9. Router split: public, authenticated-no-workspace, workspace-required.
10. Settings split: user/workspace/team with permission gates.
11. Compatibility hardening for legacy paths.
12. Final repository cleanup (no user-scoped tenant query paths).
13. Workspace chooser end-to-end integration.
14. Host resolver readiness without infra switch.

Two-surface expansion track:

1. Multi-entry frontend (`main.admin.js`, `main.app.js`).
2. Surface-specific routers.
3. API namespace split.
4. Surface-aware auth middleware.
5. Surface-specific bootstrap contracts.
6. Host/path resolver extended with surface extraction.
7. Hard UI separation between admin and app surfaces.
8. Deployment and DNS/TLS/CSP/CORS documentation.

## Acceptance Criteria

1. Personal mode works without team UI/invites.
2. Team/multi-workspace enablement does not require schema rewrite.
3. Workspace-owned API reads/writes are scoped by `workspace_id`.
4. Missing permission/context paths fail closed.
5. Path and host resolver modes map to identical `workspace_id` semantics.
6. If two-surface mode is enabled, admin/app auth and API walls remain isolated.

## Open Decisions

1. `defaultInviteRole`: app-global only, or workspace-overridable.
2. Workspace creation policy in multi-workspace mode.
3. Role definitions: manifest-only in v1, or workspace-customizable later.
4. Whether `/api/v1/bootstrap` should include CSRF token.
5. Slug mutability and redirect policy.
6. Owner transfer behavior in v1.
