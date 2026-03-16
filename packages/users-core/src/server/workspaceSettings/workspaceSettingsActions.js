import { resolveWorkspace } from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { createWorkspaceRoleCatalog } from "../../shared/roles.js";
import { workspaceSettingsResource } from "../../shared/resources/workspaceSettingsResource.js";
import { workspaceSlugParamsValidator } from "../common/validators/routeParamsValidator.js";

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
    consoleUsersOnly: false,
    permission: {
      require: "any",
      permissions: ["workspace.settings.view", "workspace.settings.update"]
    },
    inputValidator: workspaceSlugParamsValidator,
    outputValidator: workspaceSettingsResource.operations.view.outputValidator,
    idempotency: "none",
    audit: {
      actionName: "workspace.settings.read"
    },
    observability: {},
    async execute(input, context, deps) {
      const response = await deps.workspaceSettingsService.getWorkspaceSettings(resolveWorkspace(context, input), {
        context
      });

      return withWorkspaceRoleCatalog(response);
    }
  },
  {
    id: "workspace.settings.update",
    version: 1,
    kind: "command",
    channels: ["api", "assistant_tool", "internal"],
    surfacesFrom: "workspace",
    consoleUsersOnly: false,
    permission: {
      require: "all",
      permissions: ["workspace.settings.update"]
    },
    inputValidator: [workspaceSlugParamsValidator, workspaceSettingsResource.operations.patch.bodyValidator],
    outputValidator: workspaceSettingsResource.operations.patch.outputValidator,
    idempotency: "optional",
    audit: {
      actionName: "workspace.settings.update"
    },
    observability: {},
    assistantTool: {
      description: "Update workspace settings.",
      inputValidator: workspaceSettingsResource.operations.patch.bodyValidator
    },
    async execute(input, context, deps) {
      const { workspaceSlug: _workspaceSlug, ...workspaceSettingsPatch } = input;
      const response = await deps.workspaceSettingsService.updateWorkspaceSettings(
        resolveWorkspace(context, input),
        workspaceSettingsPatch,
        {
          context
        }
      );

      return withWorkspaceRoleCatalog(response);
    }
  }
]);

export { workspaceSettingsActions };
