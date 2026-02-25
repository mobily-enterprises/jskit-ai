function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 0;
  }

  return parsed;
}

function hasPermission(permissionSet, permission) {
  const requiredPermission = String(permission || "").trim();
  if (!requiredPermission) {
    return true;
  }

  const permissions = Array.isArray(permissionSet) ? permissionSet : [];
  return permissions.includes("*") || permissions.includes(requiredPermission);
}

function requireServiceMethod(service, methodName, contributorId) {
  if (!service || typeof service[methodName] !== "function") {
    throw new Error(`${contributorId} requires ${methodName}().`);
  }
}

function resolveRequest(context) {
  return context?.requestMeta?.request || null;
}

function resolveUser(context, input) {
  const payload = normalizeObject(input);
  return payload.user || resolveRequest(context)?.user || context?.actor || null;
}

function resolveWorkspace(context, input) {
  const payload = normalizeObject(input);
  return payload.workspace || resolveRequest(context)?.workspace || context?.workspace || null;
}

function requireAuthenticated(context) {
  return toPositiveInteger(context?.actor?.id) > 0;
}

function allowPublic() {
  return true;
}

function requireWorkspaceSettingsReadPermission(context) {
  return (
    hasPermission(context?.permissions, "workspace.settings.view") ||
    hasPermission(context?.permissions, "workspace.settings.update")
  );
}

const OBJECT_INPUT_SCHEMA = Object.freeze({
  parse(value) {
    return normalizeObject(value);
  }
});

const WORKSPACE_SETTINGS_UPDATE_TOOL_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: true,
  properties: {
    name: {
      type: "string",
      minLength: 1,
      maxLength: 160,
      description: "Workspace display name."
    }
  }
});

const WORKSPACE_INVITE_CREATE_TOOL_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: true,
  required: ["email", "roleId"],
  properties: {
    email: {
      type: "string",
      format: "email",
      description: "Email address to invite."
    },
    roleId: {
      type: "string",
      minLength: 1,
      description: "Workspace role id to grant."
    }
  }
});

function createWorkspaceActionContributor({
  workspaceService,
  workspaceAdminService,
  aiTranscriptsService = null
} = {}) {
  const contributorId = "workspace.core";

  requireServiceMethod(workspaceService, "buildBootstrapPayload", contributorId);
  requireServiceMethod(workspaceService, "listWorkspacesForUser", contributorId);
  requireServiceMethod(workspaceService, "listPendingInvitesForUser", contributorId);
  requireServiceMethod(workspaceService, "selectWorkspaceForUser", contributorId);
  requireServiceMethod(workspaceAdminService, "getRoleCatalog", contributorId);
  requireServiceMethod(workspaceAdminService, "getWorkspaceSettings", contributorId);
  requireServiceMethod(workspaceAdminService, "updateWorkspaceSettings", contributorId);
  requireServiceMethod(workspaceAdminService, "listMembers", contributorId);
  requireServiceMethod(workspaceAdminService, "updateMemberRole", contributorId);
  requireServiceMethod(workspaceAdminService, "listInvites", contributorId);
  requireServiceMethod(workspaceAdminService, "createInvite", contributorId);
  requireServiceMethod(workspaceAdminService, "revokeInvite", contributorId);
  requireServiceMethod(workspaceAdminService, "respondToPendingInviteByToken", contributorId);

  const actions = [
    {
      id: "workspace.bootstrap.read",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["app", "admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: allowPublic,
      idempotency: "none",
      audit: {
        actionName: "workspace.bootstrap.read"
      },
      observability: {},
      async execute(input, context) {
        return workspaceService.buildBootstrapPayload({
          request: resolveRequest(context),
          user: resolveUser(context, input)
        });
      }
    },
    {
      id: "workspace.workspaces.list",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["app", "admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireAuthenticated,
      idempotency: "none",
      audit: {
        actionName: "workspace.workspaces.list"
      },
      observability: {},
      async execute(input, context) {
        return {
          workspaces: await workspaceService.listWorkspacesForUser(resolveUser(context, input), {
            request: resolveRequest(context)
          })
        };
      }
    },
    {
      id: "workspace.select",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["app", "admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireAuthenticated,
      idempotency: "none",
      audit: {
        actionName: "workspace.select"
      },
      observability: {},
      async execute(input, context) {
        const payload = normalizeObject(input);
        const workspaceSelector = payload.workspaceSlug || payload.slug || payload.workspaceId || "";

        return workspaceService.selectWorkspaceForUser(resolveUser(context, payload), workspaceSelector, {
          request: resolveRequest(context)
        });
      }
    },
    {
      id: "workspace.invitations.pending.list",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["app", "admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireAuthenticated,
      idempotency: "none",
      audit: {
        actionName: "workspace.invitations.pending.list"
      },
      observability: {},
      async execute(input, context) {
        return {
          pendingInvites: await workspaceService.listPendingInvitesForUser(resolveUser(context, input))
        };
      }
    },
    {
      id: "workspace.roles.list",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: ["workspace.roles.view"],
      idempotency: "none",
      audit: {
        actionName: "workspace.roles.list"
      },
      observability: {},
      async execute() {
        return {
          roleCatalog: workspaceAdminService.getRoleCatalog()
        };
      }
    },
    {
      id: "workspace.settings.read",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireWorkspaceSettingsReadPermission,
      idempotency: "none",
      audit: {
        actionName: "workspace.settings.read"
      },
      observability: {},
      async execute(input, context) {
        return workspaceAdminService.getWorkspaceSettings(resolveWorkspace(context, input), {
          includeAppSurfaceDenyLists: hasPermission(context?.permissions, "workspace.settings.update")
        });
      }
    },
    {
      id: "workspace.settings.update",
      version: 1,
      kind: "command",
      channels: ["api", "assistant_tool", "internal"],
      surfaces: ["admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: ["workspace.settings.update"],
      idempotency: "optional",
      audit: {
        actionName: "workspace.settings.update"
      },
      observability: {},
      assistantTool: {
        description: "Update workspace settings.",
        inputJsonSchema: WORKSPACE_SETTINGS_UPDATE_TOOL_SCHEMA
      },
      async execute(input, context) {
        return workspaceAdminService.updateWorkspaceSettings(resolveWorkspace(context, input), normalizeObject(input));
      }
    },
    {
      id: "workspace.members.list",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: ["workspace.members.view"],
      idempotency: "none",
      audit: {
        actionName: "workspace.members.list"
      },
      observability: {},
      async execute(input, context) {
        return workspaceAdminService.listMembers(resolveWorkspace(context, input));
      }
    },
    {
      id: "workspace.member.role.update",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: ["workspace.members.manage"],
      idempotency: "optional",
      audit: {
        actionName: "workspace.member.role.update"
      },
      observability: {},
      async execute(input, context) {
        const payload = normalizeObject(input);
        return workspaceAdminService.updateMemberRole(resolveWorkspace(context, payload), {
          memberUserId: payload.memberUserId || payload.userId || payload.targetUserId || payload.params?.memberUserId,
          roleId: payload.roleId
        });
      }
    },
    {
      id: "workspace.invites.list",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: ["workspace.members.view"],
      idempotency: "none",
      audit: {
        actionName: "workspace.invites.list"
      },
      observability: {},
      async execute(input, context) {
        return workspaceAdminService.listInvites(resolveWorkspace(context, input));
      }
    },
    {
      id: "workspace.invite.create",
      version: 1,
      kind: "command",
      channels: ["api", "assistant_tool", "internal"],
      surfaces: ["admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: ["workspace.members.invite"],
      idempotency: "optional",
      audit: {
        actionName: "workspace.invite.create"
      },
      observability: {},
      assistantTool: {
        description: "Invite a person to the workspace.",
        inputJsonSchema: WORKSPACE_INVITE_CREATE_TOOL_SCHEMA
      },
      async execute(input, context) {
        return workspaceAdminService.createInvite(
          resolveWorkspace(context, input),
          resolveUser(context, input),
          normalizeObject(input)
        );
      }
    },
    {
      id: "workspace.invite.revoke",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: ["workspace.invites.revoke"],
      idempotency: "optional",
      audit: {
        actionName: "workspace.invite.revoke"
      },
      observability: {},
      async execute(input, context) {
        const payload = normalizeObject(input);
        return workspaceAdminService.revokeInvite(
          resolveWorkspace(context, payload),
          payload.inviteId || payload.params?.inviteId
        );
      }
    },
    {
      id: "workspace.invite.redeem",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["app", "admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireAuthenticated,
      idempotency: "optional",
      audit: {
        actionName: "workspace.invite.redeem"
      },
      observability: {},
      async execute(input, context) {
        const payload = normalizeObject(input);
        return workspaceAdminService.respondToPendingInviteByToken({
          user: resolveUser(context, payload),
          inviteToken: payload.token || payload.inviteToken,
          decision: payload.decision
        });
      }
    }
  ];

  if (
    aiTranscriptsService &&
    typeof aiTranscriptsService.listWorkspaceConversations === "function" &&
    typeof aiTranscriptsService.getWorkspaceConversationMessages === "function" &&
    typeof aiTranscriptsService.exportWorkspaceConversation === "function"
  ) {
    actions.push(
      {
        id: "workspace.ai.transcripts.list",
        version: 1,
        kind: "query",
        channels: ["api", "internal"],
        surfaces: ["admin"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: ["workspace.ai.transcripts.read"],
        idempotency: "none",
        audit: {
          actionName: "workspace.ai.transcripts.list"
        },
        observability: {},
        async execute(input, context) {
          return aiTranscriptsService.listWorkspaceConversations(resolveWorkspace(context, input), normalizeObject(input));
        }
      },
      {
        id: "workspace.ai.transcript.messages.get",
        version: 1,
        kind: "query",
        channels: ["api", "internal"],
        surfaces: ["admin"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: ["workspace.ai.transcripts.read"],
        idempotency: "none",
        audit: {
          actionName: "workspace.ai.transcript.messages.get"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          const conversationId = payload.conversationId || payload.params?.conversationId;
          return aiTranscriptsService.getWorkspaceConversationMessages(
            resolveWorkspace(context, payload),
            conversationId,
            payload
          );
        }
      },
      {
        id: "workspace.ai.transcript.export",
        version: 1,
        kind: "query",
        channels: ["api", "internal"],
        surfaces: ["admin"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: ["workspace.ai.transcripts.export"],
        idempotency: "none",
        audit: {
          actionName: "workspace.ai.transcript.export"
        },
        observability: {},
        async execute(input, context) {
          const payload = normalizeObject(input);
          const conversationId = payload.conversationId || payload.params?.conversationId;
          return aiTranscriptsService.exportWorkspaceConversation(resolveWorkspace(context, payload), conversationId, payload);
        }
      }
    );
  }

  return {
    contributorId,
    domain: "workspace",
    actions: Object.freeze(actions)
  };
}

export { createWorkspaceActionContributor };
