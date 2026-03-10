import {
  normalizeObject,
  resolveWorkspace,
  OBJECT_INPUT_SCHEMA
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { hasPermission } from "../../shared/roles.js";
import { workspaceSettingsSchema } from "../../shared/schemas/resources/workspaceSettingsSchema.js";

function canReadWorkspaceSettings(context) {
  return (
    hasPermission(context?.permissions, "workspace.settings.view") ||
    hasPermission(context?.permissions, "workspace.settings.update")
  );
}

const workspaceSettingsActions = Object.freeze([
  {
    id: "workspace.settings.read",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfacesFrom: "workspace",
    visibility: "public",
    inputSchema: OBJECT_INPUT_SCHEMA,
    permission: canReadWorkspaceSettings,
    idempotency: "none",
    audit: {
      actionName: "workspace.settings.read"
    },
    observability: {},
    async execute(input, context, deps) {
      const response = await deps.workspaceSettingsService.getWorkspaceSettings(resolveWorkspace(context, input), {
        includeAppSurfaceDenyLists: hasPermission(context?.permissions, "workspace.settings.update")
      });

      return workspaceSettingsSchema.operations.view.output.normalize(response);
    }
  },
  {
    id: "workspace.settings.update",
    version: 1,
    kind: "command",
    channels: ["api", "assistant_tool", "internal"],
    surfacesFrom: "workspace",
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
    async execute(input, context, deps) {
      const { workspaceSlug: _workspaceSlug, ...workspaceSettingsPatch } = normalizeObject(input);
      const response = await deps.workspaceSettingsService.updateWorkspaceSettings(
        resolveWorkspace(context, input),
        workspaceSettingsPatch
      );

      return workspaceSettingsSchema.operations.patch.output.normalize(response);
    }
  }
]);

export { workspaceSettingsActions };
