import { withStandardErrorResponses } from "../../api/schema.js";

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
      path: "/api/workspace/ai/transcripts",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "workspace.ai.transcripts.read",
      schema: {
        tags: ["workspace-ai-transcripts"],
        summary: "List AI transcript conversations for the active workspace",
        querystring: schema.query.aiTranscripts,
        response: withStandardErrorResponses(
          {
            200: schema.response.aiTranscriptsList
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.workspace?.listWorkspaceAiTranscripts || missingHandler
    },
    {
      path: "/api/workspace/ai/transcripts/:conversationId/messages",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "workspace.ai.transcripts.read",
      schema: {
        tags: ["workspace-ai-transcripts"],
        summary: "List messages for one AI transcript conversation in the active workspace",
        params: schema.params.conversation,
        querystring: schema.query.aiTranscriptMessages,
        response: withStandardErrorResponses(
          {
            200: schema.response.aiTranscriptMessages
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.workspace?.getWorkspaceAiTranscriptMessages || missingHandler
    },
    {
      path: "/api/workspace/ai/transcripts/:conversationId/export",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "workspace.ai.transcripts.export",
      schema: {
        tags: ["workspace-ai-transcripts"],
        summary: "Export one AI transcript conversation for the active workspace",
        params: schema.params.conversation,
        querystring: schema.query.aiTranscriptExport,
        response: withStandardErrorResponses(
          {
            200: schema.response.aiTranscriptExport
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.workspace?.exportWorkspaceAiTranscript || missingHandler
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
