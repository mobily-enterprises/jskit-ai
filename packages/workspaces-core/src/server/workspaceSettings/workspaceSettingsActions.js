import { composeSchemaDefinitions } from "@jskit-ai/kernel/shared/validators";
import { returnJsonApiData } from "@jskit-ai/http-runtime/shared";
import { workspaceSettingsResource } from "../../shared/resources/workspaceSettingsResource.js";
import { workspaceSlugParamsValidator } from "../common/validators/routeParamsValidator.js";
import { resolveWorkspace } from "../support/resolveWorkspace.js";

const workspaceSettingsUpdateInputValidator = composeSchemaDefinitions([
  workspaceSlugParamsValidator,
  workspaceSettingsResource.operations.patch.body
], {
  mode: "patch",
  context: "workspaceSettingsActions.workspaceSettingsUpdateInputValidator"
});

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
    output: null,
    idempotency: "none",
    audit: {
      actionName: "workspace.settings.read"
    },
    observability: {},
    async execute(input, context, deps) {
      const response = await deps.workspaceSettingsService.getWorkspaceSettings(resolveWorkspace(context, input), {
        context
      });

      return returnJsonApiData(response);
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
    input: workspaceSettingsUpdateInputValidator,
    output: null,
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
      const { workspaceSlug, ...patch } = input;
      const response = await deps.workspaceSettingsService.updateWorkspaceSettings(
        resolveWorkspace(context, input),
        patch,
        {
          context
        }
      );

      return returnJsonApiData(response);
    }
  }
]);

export { workspaceSettingsActions };
