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
    permission: {
      require: "any",
      permissions: ["workspace.settings.view", "workspace.settings.update"]
    },
    input: workspaceSlugParamsValidator,
    output: workspaceSettingsResource.operations.view.output,
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
    permission: {
      require: "all",
      permissions: ["workspace.settings.update"]
    },
    input: [
      workspaceSlugParamsValidator,
      {
        patch: workspaceSettingsResource.operations.patch.body
      }
    ],
    output: workspaceSettingsResource.operations.patch.output,
    idempotency: "optional",
    audit: {
      actionName: "workspace.settings.update"
    },
    observability: {},
    extensions: {
      assistant: {
        description: "Update workspace settings."
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
