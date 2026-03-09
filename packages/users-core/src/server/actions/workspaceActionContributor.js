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
import { workspaceSettingsSchema } from "../../shared/schemas/resources/workspaceSettingsSchema.js";
import { workspaceInviteSchema } from "../../shared/contracts/resources/workspaceInviteSchema.js";

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

const DEFAULT_WORKSPACE_CHANNELS = Object.freeze(["api", "internal"]);
const WORKSPACE_SERVICE_METHODS = Object.freeze([
  "buildBootstrapPayload",
  "listWorkspacesForUser",
  "listPendingInvitesForUser"
]);
const WORKSPACE_ADMIN_SERVICE_METHODS = Object.freeze([
  "getRoleCatalog",
  "getWorkspaceSettings",
  "updateWorkspaceSettings",
  "listMembers",
  "updateMemberRole",
  "listInvites",
  "createInvite",
  "revokeInvite",
  "respondToPendingInviteByToken"
]);

function createWorkspaceActionDefinition({
  id,
  kind = "query",
  channels = DEFAULT_WORKSPACE_CHANNELS,
  surfaces = [],
  permission = requireAuthenticated,
  idempotency = "none",
  assistantTool = null,
  execute
} = {}) {
  const action = {
    id,
    version: 1,
    kind,
    channels,
    surfaces,
    visibility: "public",
    inputSchema: OBJECT_INPUT_SCHEMA,
    permission,
    idempotency,
    audit: {
      actionName: id
    },
    observability: {},
    execute
  };

  if (assistantTool) {
    action.assistantTool = assistantTool;
  }

  return action;
}

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

  if (enabledSurfaceIds.length < 1) {
    throw new Error("users.workspace action contributor requires at least one enabled surface.");
  }

  return Object.freeze({
    enabledSurfaceIds: Object.freeze([...enabledSurfaceIds]),
    workspaceSurfaceIds: Object.freeze([...workspaceSurfaceIds])
  });
}

function createWorkspaceActionContributor({ workspaceService, workspaceAdminService, surfaceRuntime } = {}) {
  const contributorId = "users.workspace";
  const runtimeSurfaces = resolveRuntimeSurfaceIds(surfaceRuntime);

  for (const methodName of WORKSPACE_SERVICE_METHODS) {
    requireServiceMethod(workspaceService, methodName, contributorId);
  }

  for (const methodName of WORKSPACE_ADMIN_SERVICE_METHODS) {
    requireServiceMethod(workspaceAdminService, methodName, contributorId);
  }

  const actions = [
    createWorkspaceActionDefinition({
      id: "workspace.bootstrap.read",
      surfaces: runtimeSurfaces.enabledSurfaceIds,
      permission: allowPublic,
      execute: async (input, context) => {
        const payload = normalizeObject(input);
        return workspaceService.buildBootstrapPayload({
          request: resolveRequest(context),
          user: resolveUser(context, payload),
          workspaceSlug: payload.workspaceSlug
        });
      }
    }),
    createWorkspaceActionDefinition({
      id: "workspace.workspaces.list",
      surfaces: runtimeSurfaces.enabledSurfaceIds,
      permission: requireAuthenticated,
      execute: async (input, context) => {
        return {
          workspaces: await workspaceService.listWorkspacesForUser(resolveUser(context, input), {
            request: resolveRequest(context)
          })
        };
      }
    }),
    createWorkspaceActionDefinition({
      id: "workspace.invitations.pending.list",
      surfaces: runtimeSurfaces.enabledSurfaceIds,
      permission: requireAuthenticated,
      execute: async (input, context) => {
        return {
          pendingInvites: await workspaceService.listPendingInvitesForUser(resolveUser(context, input))
        };
      }
    }),
    createWorkspaceActionDefinition({
      id: "workspace.roles.list",
      surfaces: runtimeSurfaces.workspaceSurfaceIds,
      permission: ["workspace.roles.view"],
      execute: async () => {
        return {
          roleCatalog: workspaceAdminService.getRoleCatalog()
        };
      }
    }),
    createWorkspaceActionDefinition({
      id: "workspace.settings.read",
      surfaces: runtimeSurfaces.workspaceSurfaceIds,
      permission: requireWorkspaceSettingsReadPermission,
      execute: async (input, context) => {
        return workspaceAdminService.getWorkspaceSettings(resolveWorkspace(context, input), {
          includeAppSurfaceDenyLists: hasPermission(context?.permissions, "workspace.settings.update")
        });
      }
    }),
    createWorkspaceActionDefinition({
      id: "workspace.settings.update",
      kind: "command",
      channels: ["api", "assistant_tool", "internal"],
      surfaces: runtimeSurfaces.workspaceSurfaceIds,
      permission: ["workspace.settings.update"],
      idempotency: "optional",
      assistantTool: {
        description: "Update workspace settings.",
        inputJsonSchema: workspaceSettingsSchema.operations.patch.body.schema
      },
      execute: async (input, context) => {
        return workspaceAdminService.updateWorkspaceSettings(resolveWorkspace(context, input), normalizeObject(input));
      }
    }),
    createWorkspaceActionDefinition({
      id: "workspace.members.list",
      surfaces: runtimeSurfaces.workspaceSurfaceIds,
      permission: ["workspace.members.view"],
      execute: async (input, context) => {
        return workspaceAdminService.listMembers(resolveWorkspace(context, input));
      }
    }),
    createWorkspaceActionDefinition({
      id: "workspace.member.role.update",
      kind: "command",
      surfaces: runtimeSurfaces.workspaceSurfaceIds,
      permission: ["workspace.members.manage"],
      idempotency: "optional",
      execute: async (input, context) => {
        const payload = normalizeObject(input);
        return workspaceAdminService.updateMemberRole(resolveWorkspace(context, payload), {
          memberUserId: payload.memberUserId || payload.userId || payload.targetUserId || payload.params?.memberUserId,
          roleId: payload.roleId
        });
      }
    }),
    createWorkspaceActionDefinition({
      id: "workspace.invites.list",
      surfaces: runtimeSurfaces.workspaceSurfaceIds,
      permission: ["workspace.members.view"],
      execute: async (input, context) => {
        return workspaceAdminService.listInvites(resolveWorkspace(context, input));
      }
    }),
    createWorkspaceActionDefinition({
      id: "workspace.invite.create",
      kind: "command",
      channels: ["api", "assistant_tool", "internal"],
      surfaces: runtimeSurfaces.workspaceSurfaceIds,
      permission: ["workspace.members.invite"],
      idempotency: "optional",
      assistantTool: {
        description: "Invite a person to the workspace.",
        inputJsonSchema: workspaceInviteSchema.operations.create.body.schema
      },
      execute: async (input, context) => {
        return workspaceAdminService.createInvite(
          resolveWorkspace(context, input),
          resolveUser(context, input),
          normalizeObject(input)
        );
      }
    }),
    createWorkspaceActionDefinition({
      id: "workspace.invite.revoke",
      kind: "command",
      surfaces: runtimeSurfaces.workspaceSurfaceIds,
      permission: ["workspace.invites.revoke"],
      idempotency: "optional",
      execute: async (input, context) => {
        const payload = normalizeObject(input);
        return workspaceAdminService.revokeInvite(
          resolveWorkspace(context, payload),
          payload.inviteId || payload.params?.inviteId
        );
      }
    }),
    createWorkspaceActionDefinition({
      id: "workspace.invite.redeem",
      kind: "command",
      surfaces: runtimeSurfaces.enabledSurfaceIds,
      permission: requireAuthenticated,
      idempotency: "optional",
      execute: async (input, context) => {
        const payload = normalizeObject(input);
        return workspaceAdminService.respondToPendingInviteByToken({
          user: resolveUser(context, payload),
          inviteToken: payload.token || payload.inviteToken,
          decision: payload.decision
        });
      }
    })
  ];

  const actionsWithVisibleSurfaces = [];
  for (const action of actions) {
    if (Array.isArray(action.surfaces) && action.surfaces.length > 0) {
      actionsWithVisibleSurfaces.push(action);
    }
  }

  return {
    contributorId,
    domain: "workspace",
    actions: Object.freeze(actionsWithVisibleSurfaces)
  };
}

export { createWorkspaceActionContributor };
