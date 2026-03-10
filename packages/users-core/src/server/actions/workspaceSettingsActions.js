import {
  normalizeObject,
  requireServiceMethod,
  resolveWorkspace,
  OBJECT_INPUT_SCHEMA
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { hasPermission } from "../../shared/roles.js";
import { workspaceSettingsSchema } from "../../shared/schemas/resources/workspaceSettingsSchema.js";

function requireWorkspaceSettingsReadPermission(context) {
  return (
    hasPermission(context?.permissions, "workspace.settings.view") ||
    hasPermission(context?.permissions, "workspace.settings.update")
  );
}

function resolveWorkspaceSurfaceIds(surfaceRuntime) {
  if (!surfaceRuntime || typeof surfaceRuntime.listWorkspaceSurfaceIds !== "function") {
    throw new Error("users.workspace-settings action contributor requires surfaceRuntime.listWorkspaceSurfaceIds().");
  }

  const workspaceSurfaceIds = surfaceRuntime.listWorkspaceSurfaceIds();
  if (workspaceSurfaceIds.length < 1) {
    return Object.freeze([]);
  }

  return Object.freeze([...workspaceSurfaceIds]);
}

function createWorkspaceSettingsActionContributor({ workspaceAdminService, surfaceRuntime } = {}) {
  const contributorId = "users.workspace-settings";
  const workspaceSurfaceIds = resolveWorkspaceSurfaceIds(surfaceRuntime);

  requireServiceMethod(workspaceAdminService, "getWorkspaceSettings", contributorId, {
    serviceLabel: "workspaceAdminService"
  });
  requireServiceMethod(workspaceAdminService, "updateWorkspaceSettings", contributorId, {
    serviceLabel: "workspaceAdminService"
  });

  if (workspaceSurfaceIds.length < 1) {
    return {
      contributorId,
      domain: "workspace-settings",
      actions: Object.freeze([])
    };
  }

  const actions = [
    {
      id: "workspace.settings.read",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: workspaceSurfaceIds,
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
      surfaces: workspaceSurfaceIds,
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
        inputJsonSchema: workspaceSettingsSchema.operations.patch.body.schema
      },
      async execute(input, context) {
        return workspaceAdminService.updateWorkspaceSettings(resolveWorkspace(context, input), normalizeObject(input));
      }
    }
  ];

  return {
    contributorId,
    domain: "workspace-settings",
    actions: Object.freeze(actions)
  };
}

export { createWorkspaceSettingsActionContributor };
