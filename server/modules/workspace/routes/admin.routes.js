import { withStandardErrorResponses } from "../../api/schemas.js";

function buildRoutes(controllers, { missingHandler, schema }) {
  return [
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
          200: schema.response.settings
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
        body: schema.body.settingsUpdate,
        response: withStandardErrorResponses(
          {
            200: schema.response.settings
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
          200: schema.response.roles
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
          200: schema.response.members
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
        params: schema.params.member,
        body: schema.body.memberRoleUpdate,
        response: withStandardErrorResponses(
          {
            200: schema.response.members
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
          200: schema.response.invites
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
        body: schema.body.createInvite,
        response: withStandardErrorResponses(
          {
            200: schema.response.invites
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
        params: schema.params.invite,
        response: withStandardErrorResponses({
          200: schema.response.invites
        })
      },
      handler: controllers.workspace?.revokeWorkspaceInvite || missingHandler
    }
  ];
}

export { buildRoutes };
