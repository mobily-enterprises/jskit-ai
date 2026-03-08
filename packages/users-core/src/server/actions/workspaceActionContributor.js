import {
  normalizeObject,
  requireAuthenticated,
  requireServiceMethod,
  resolveRequest,
  resolveUser,
  resolveWorkspace,
  allowPublic,
  OBJECT_INPUT_SCHEMA
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";

function hasPermission(permissionSet, permission) {
  const requiredPermission = String(permission || "").trim();
  if (!requiredPermission) {
    return true;
  }

  const permissions = Array.isArray(permissionSet) ? permissionSet : [];
  return permissions.includes("*") || permissions.includes(requiredPermission);
}

function requireWorkspaceSettingsReadPermission(context) {
  return (
    hasPermission(context?.permissions, "workspace.settings.view") ||
    hasPermission(context?.permissions, "workspace.settings.update")
  );
}

const WORKSPACE_SETTINGS_UPDATE_TOOL_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: true,
  properties: {
    name: {
      type: "string",
      minLength: 1,
      maxLength: 160,
      description: "Workspace display name."
    },
    avatarUrl: {
      type: "string",
      description: "Workspace avatar URL."
    },
    color: {
      type: "string",
      pattern: "^#[0-9A-Fa-f]{6}$",
      description: "Workspace color in #RRGGBB format."
    },
    invitesEnabled: {
      type: "boolean",
      description: "Whether workspace invites are enabled."
    },
    appDenyEmails: {
      type: "array",
      items: {
        type: "string",
        format: "email"
      },
      description: "App surface deny-list email addresses."
    },
    appDenyUserIds: {
      type: "array",
      items: {
        type: "integer",
        minimum: 1
      },
      description: "App surface deny-list user IDs."
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

function resolveRuntimeSurfaceIds(surfaceRuntime) {
  if (
    !surfaceRuntime ||
    typeof surfaceRuntime.listEnabledSurfaceIds !== "function" ||
    typeof surfaceRuntime.listWorkspaceSurfaceIds !== "function"
  ) {
    throw new Error("users.workspace action contributor requires surfaceRuntime capability helpers.");
  }

  const enabledSurfaceIds = surfaceRuntime.listEnabledSurfaceIds();
  const workspaceSurfaceIds = surfaceRuntime.listWorkspaceSurfaceIds();
  const workspaceSurfaceSet = new Set(workspaceSurfaceIds);
  const nonWorkspaceSurfaceIds = enabledSurfaceIds.filter((surfaceId) => !workspaceSurfaceSet.has(surfaceId));

  if (enabledSurfaceIds.length < 1) {
    throw new Error("users.workspace action contributor requires at least one enabled surface.");
  }

  return Object.freeze({
    enabledSurfaceIds: Object.freeze([...enabledSurfaceIds]),
    workspaceSurfaceIds: Object.freeze([...workspaceSurfaceIds]),
    nonWorkspaceSurfaceIds: Object.freeze([...nonWorkspaceSurfaceIds])
  });
}

function createWorkspaceActionContributor({ workspaceService, workspaceAdminService, surfaceRuntime } = {}) {
  const contributorId = "users.workspace";
  const runtimeSurfaces = resolveRuntimeSurfaceIds(surfaceRuntime);

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
      surfaces: runtimeSurfaces.enabledSurfaceIds,
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
      surfaces: runtimeSurfaces.enabledSurfaceIds,
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
      surfaces: runtimeSurfaces.enabledSurfaceIds,
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
      surfaces: runtimeSurfaces.enabledSurfaceIds,
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
      surfaces: runtimeSurfaces.workspaceSurfaceIds,
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
      surfaces: runtimeSurfaces.workspaceSurfaceIds,
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
      surfaces: runtimeSurfaces.workspaceSurfaceIds,
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
      surfaces: runtimeSurfaces.workspaceSurfaceIds,
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
      surfaces: runtimeSurfaces.workspaceSurfaceIds,
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
      surfaces: runtimeSurfaces.workspaceSurfaceIds,
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
      surfaces: runtimeSurfaces.workspaceSurfaceIds,
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
      surfaces: runtimeSurfaces.workspaceSurfaceIds,
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
      surfaces: runtimeSurfaces.enabledSurfaceIds,
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
  ].filter((action) => Array.isArray(action.surfaces) && action.surfaces.length > 0);

  return {
    contributorId,
    domain: "workspace",
    actions: Object.freeze(actions)
  };
}

export { createWorkspaceActionContributor };
