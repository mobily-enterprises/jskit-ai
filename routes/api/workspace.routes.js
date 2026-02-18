import {
  workspaceSettingsResponseSchema,
  workspaceSettingsUpdateBodySchema,
  workspaceMembersResponseSchema,
  workspaceMemberRoleUpdateBodySchema,
  workspaceInvitesResponseSchema,
  workspaceCreateInviteBodySchema,
  workspaceRolesResponseSchema,
  pendingInvitesResponseSchema,
  redeemPendingInviteBodySchema,
  respondToPendingInviteResponseSchema,
  bootstrapResponseSchema,
  workspacesListResponseSchema,
  selectWorkspaceBodySchema,
  selectWorkspaceResponseSchema,
  inviteIdParamsSchema,
  memberUserIdParamsSchema
} from "./workspace.schemas.js";
import { withStandardErrorResponses } from "./common.schemas.js";

function buildWorkspaceRoutes(controllers, { missingHandler }) {
  return [
    {
      path: "/api/bootstrap",
      method: "GET",
      auth: "public",
      schema: {
        tags: ["workspace"],
        summary: "Get startup bootstrap payload with session, app, workspace, and settings context",
        response: withStandardErrorResponses({
          200: bootstrapResponseSchema
        })
      },
      handler: controllers.workspace?.bootstrap || missingHandler
    },
    {
      path: "/api/workspaces",
      method: "GET",
      auth: "required",
      allowNoWorkspace: true,
      schema: {
        tags: ["workspace"],
        summary: "List workspaces visible to authenticated user",
        response: withStandardErrorResponses({
          200: workspacesListResponseSchema
        })
      },
      handler: controllers.workspace?.listWorkspaces || missingHandler
    },
    {
      path: "/api/workspaces/select",
      method: "POST",
      auth: "required",
      allowNoWorkspace: true,
      schema: {
        tags: ["workspace"],
        summary: "Select active workspace by slug or id",
        body: selectWorkspaceBodySchema,
        response: withStandardErrorResponses(
          {
            200: selectWorkspaceResponseSchema
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.workspace?.selectWorkspace || missingHandler
    },
    {
      path: "/api/workspace/invitations/pending",
      method: "GET",
      auth: "required",
      allowNoWorkspace: true,
      schema: {
        tags: ["workspace"],
        summary: "List pending workspace invitations for authenticated user",
        response: withStandardErrorResponses({
          200: pendingInvitesResponseSchema
        })
      },
      handler: controllers.workspace?.listPendingInvites || missingHandler
    },
    {
      path: "/api/workspace/invitations/redeem",
      method: "POST",
      auth: "required",
      allowNoWorkspace: true,
      schema: {
        tags: ["workspace"],
        summary: "Accept or refuse a workspace invitation using an invite token",
        body: redeemPendingInviteBodySchema,
        response: withStandardErrorResponses(
          {
            200: respondToPendingInviteResponseSchema
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.workspace?.respondToPendingInviteByToken || missingHandler
    },
    {
      path: "/api/workspace/settings",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "workspace.settings.view",
      schema: {
        tags: ["workspace"],
        summary: "Get active workspace settings and role catalog",
        response: withStandardErrorResponses({
          200: workspaceSettingsResponseSchema
        })
      },
      handler: controllers.workspace?.getWorkspaceSettings || missingHandler
    },
    {
      path: "/api/workspace/settings",
      method: "PATCH",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "workspace.settings.update",
      schema: {
        tags: ["workspace"],
        summary: "Update active workspace settings",
        body: workspaceSettingsUpdateBodySchema,
        response: withStandardErrorResponses(
          {
            200: workspaceSettingsResponseSchema
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.workspace?.updateWorkspaceSettings || missingHandler
    },
    {
      path: "/api/workspace/roles",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "workspace.roles.view",
      schema: {
        tags: ["workspace"],
        summary: "Get workspace role catalog",
        response: withStandardErrorResponses({
          200: workspaceRolesResponseSchema
        })
      },
      handler: controllers.workspace?.listWorkspaceRoles || missingHandler
    },
    {
      path: "/api/workspace/members",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "workspace.members.view",
      schema: {
        tags: ["workspace"],
        summary: "List active members for active workspace",
        response: withStandardErrorResponses({
          200: workspaceMembersResponseSchema
        })
      },
      handler: controllers.workspace?.listWorkspaceMembers || missingHandler
    },
    {
      path: "/api/workspace/members/:memberUserId/role",
      method: "PATCH",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "workspace.members.manage",
      schema: {
        tags: ["workspace"],
        summary: "Update member role in active workspace",
        params: memberUserIdParamsSchema,
        body: workspaceMemberRoleUpdateBodySchema,
        response: withStandardErrorResponses(
          {
            200: workspaceMembersResponseSchema
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.workspace?.updateWorkspaceMemberRole || missingHandler
    },
    {
      path: "/api/workspace/invites",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "workspace.members.view",
      schema: {
        tags: ["workspace"],
        summary: "List pending invites for active workspace",
        response: withStandardErrorResponses({
          200: workspaceInvitesResponseSchema
        })
      },
      handler: controllers.workspace?.listWorkspaceInvites || missingHandler
    },
    {
      path: "/api/workspace/invites",
      method: "POST",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "workspace.members.invite",
      schema: {
        tags: ["workspace"],
        summary: "Create invite for active workspace",
        body: workspaceCreateInviteBodySchema,
        response: withStandardErrorResponses(
          {
            200: workspaceInvitesResponseSchema
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: controllers.workspace?.createWorkspaceInvite || missingHandler
    },
    {
      path: "/api/workspace/invites/:inviteId",
      method: "DELETE",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "workspace.invites.revoke",
      schema: {
        tags: ["workspace"],
        summary: "Revoke pending invite in active workspace",
        params: inviteIdParamsSchema,
        response: withStandardErrorResponses({
          200: workspaceInvitesResponseSchema
        })
      },
      handler: controllers.workspace?.revokeWorkspaceInvite || missingHandler
    }
  ];
}

export { buildWorkspaceRoutes };
