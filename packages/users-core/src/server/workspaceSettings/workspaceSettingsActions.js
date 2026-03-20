import { workspaceSettingsResource } from "../../shared/resources/workspaceSettingsResource.js";
import { workspaceSlugParamsValidator } from "../common/validators/routeParamsValidator.js";
import { resolveWorkspace } from "../support/resolveWorkspace.js";

const workspaceSettingsActions = Object.freeze([
  {
    id: "workspace.settings.read",
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
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

      return response;
    }
  },
  {
    id: "workspace.settings.update",
    version: 1,
    kind: "command",
    channels: ["api", "assistant_tool", "automation", "internal"],
    surfacesFrom: "workspace",
    consoleUsersOnly: false,
    permission: {
      require: "all",
      permissions: ["workspace.settings.update"]
    },
    inputValidator: [
      workspaceSlugParamsValidator,
      {
        patch: workspaceSettingsResource.operations.patch.bodyValidator
      }
    ],
    outputValidator: workspaceSettingsResource.operations.patch.outputValidator,
    idempotency: "optional",
    audit: {
      actionName: "workspace.settings.update"
    },
    observability: {},
    assistantTool: {
      description: "Update workspace settings.",
      inputValidator: {
        patch: workspaceSettingsResource.operations.patch.bodyValidator
      }
    },
    async execute(input, context, deps) {
      const response = await deps.workspaceSettingsService.updateWorkspaceSettings(
        resolveWorkspace(context, input),
        input.patch,
        {
          context
        }
      );

      return response;
    }
  }
]);

export { workspaceSettingsActions };
