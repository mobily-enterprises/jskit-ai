import { resolveWorkspace } from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { createWorkspaceRoleCatalog, hasPermission } from "../../shared/roles.js";
import { workspaceSettingsSchema } from "../../shared/schemas/resources/workspaceSettingsSchema.js";
import { inputParts } from "../common/contracts/inputParts.js";

function canReadWorkspaceSettings(context) {
  return (
    hasPermission(context?.permissions, "workspace.settings.view") ||
    hasPermission(context?.permissions, "workspace.settings.update")
  );
}

function withWorkspaceRoleCatalog(payload = {}) {
  return {
    ...payload,
    roleCatalog: createWorkspaceRoleCatalog()
  };
}

const workspaceSettingsActions = Object.freeze([
  {
    id: "workspace.settings.read",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfacesFrom: "workspace",
    visibility: "public",
    input: inputParts.routeParams,
    output: workspaceSettingsSchema.operations.view.output,
    permission: canReadWorkspaceSettings,
    idempotency: "none",
    audit: {
      actionName: "workspace.settings.read"
    },
    observability: {},
    async execute(input, context, deps) {
      const response = await deps.workspaceSettingsService.getWorkspaceSettings(resolveWorkspace(context, input));

      return withWorkspaceRoleCatalog(response);
    }
  },
  {
    id: "workspace.settings.update",
    version: 1,
    kind: "command",
    channels: ["api", "assistant_tool", "internal"],
    surfacesFrom: "workspace",
    visibility: "public",
    input: [inputParts.routeParams, workspaceSettingsSchema.operations.patch.body],
    output: workspaceSettingsSchema.operations.patch.output,
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
      const { workspaceSlug: _workspaceSlug, ...workspaceSettingsPatch } = input;
      const response = await deps.workspaceSettingsService.updateWorkspaceSettings(
        resolveWorkspace(context, input),
        workspaceSettingsPatch
      );

      return withWorkspaceRoleCatalog(response);
    }
  }
]);

export { workspaceSettingsActions };
