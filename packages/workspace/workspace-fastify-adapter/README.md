# @jskit-ai/workspace-fastify-adapter

Fastify adapter for workspace-facing APIs (bootstrap, workspace selection, workspace admin, invites, AI transcript access).

## What this package is for

Use this package to expose workspace workflows over HTTP.

It supports:

- user bootstrap and workspace selection
- reading/updating workspace settings
- role/member/invite administration
- pending-invite acceptance/decline flows
- workspace-level AI transcript listing/export

## Key terms (plain language)

- `workspace`: a scoped collaboration area containing users, settings, and data.
- `workspace context`: currently selected workspace plus permission state.
- `pending invite`: invite not yet accepted or declined.

## Public API

## `createController(deps)`

Creates workspace controller handlers.

Returned handlers:

- `bootstrap`
  - Returns initial workspace-context payload.
  - Real example: app loads current workspace and permissions after login.
- `listWorkspaces`
  - Lists user-accessible workspaces.
  - Real example: workspace switcher dropdown.
- `selectWorkspace`
  - Changes active workspace.
  - Real example: user switches from personal to team workspace.
- `getWorkspaceSettings`
  - Reads admin-visible workspace settings.
  - Real example: admin settings page load.
- `updateWorkspaceSettings`
  - Updates workspace settings.
  - Real example: toggle invite policy for workspace.
- `listWorkspaceRoles`
  - Lists role catalog for workspace admin.
  - Real example: assign-role modal options.
- `listWorkspaceMembers`
  - Lists members.
  - Real example: team members management table.
- `updateWorkspaceMemberRole`
  - Updates one member role.
  - Real example: demote admin to member.
- `listWorkspaceInvites`
  - Lists active invites.
  - Real example: view pending invitations and expiry dates.
- `createWorkspaceInvite`
  - Creates invite.
  - Real example: invite contractor by email.
- `revokeWorkspaceInvite`
  - Revokes invite.
  - Real example: cancel invite before acceptance.
- `listPendingInvites`
  - Lists pending invites visible to current user.
  - Real example: show all invites user can accept.
- `respondToPendingInviteByToken`
  - Accept/decline invite via token.
  - Real example: user clicks invite email and accepts.
- `listWorkspaceAiTranscripts`
  - Lists workspace assistant transcript sessions.
  - Real example: workspace owner audits AI usage.
- `getWorkspaceAiTranscriptMessages`
  - Reads messages from one transcript.
  - Real example: review conversation details.
- `exportWorkspaceAiTranscript`
  - Exports transcript data.
  - Real example: compliance archive export.

## `buildRoutes(controller, options)`

Builds all workspace-related route definitions.

Real examples include routes for:

- `/api/bootstrap`
- `/api/workspaces` and `/api/workspaces/select`
- workspace admin settings/members/invites paths

## `schema`

Exports shared schemas for request and response validation.

Real example: invalid workspace invite payloads are rejected consistently.

## How apps use this package (and why)

Typical flow:

1. App initializes workspace core/admin services.
2. Adapter creates controller and routes.
3. Frontend calls these endpoints for workspace UX.

Why apps use it:

- complete workspace API boundary in one package
- consistent workspace behavior across multiple apps
