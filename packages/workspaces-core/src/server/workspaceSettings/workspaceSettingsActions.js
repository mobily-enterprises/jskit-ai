import { composeSchemaDefinitions } from "@jskit-ai/kernel/shared/validators";
import { returnJsonApiData } from "@jskit-ai/http-runtime/shared";
import { workspaceSettingsResource } from "../../shared/resources/workspaceSettingsResource.js";
import { workspaceSlugParamsValidator } from "../common/validators/routeParamsValidator.js";
import { createWorkspaceEntityAndBootstrapEvents } from "../common/support/realtimeServiceEvents.js";
import { resolveWorkspace } from "../support/resolveWorkspace.js";

const WORKSPACE_SETTINGS_CHANGED_EVENTS = createWorkspaceEntityAndBootstrapEvents({
  workspaceEntity: "settings",
  workspaceOperation: "updated",
  workspaceRealtimeEvent: "workspace.settings.changed"
});

const workspaceSettingsUpdateInputValidator = composeSchemaDefinitions([
  workspaceSlugParamsValidator,
  workspaceSettingsResource.operations.patch.body
], {
  mode: "patch",
  context: "workspaceSettingsActions.workspaceSettingsUpdateInputValidator"
});

const workspaceSettingsActionSpecifications = Object.freeze([
  {
    id: "workspace.settings.read",
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["*"],
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
    async run(workspaceSettingsService, input, context) {
      const response = await workspaceSettingsService.getWorkspaceSettings(resolveWorkspace(context, input), {
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
    surfaces: ["*"],
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
    events: WORKSPACE_SETTINGS_CHANGED_EVENTS,
    extensions: {
      assistant: {
        description: "Update workspace settings."
      }
    },
    async run(workspaceSettingsService, input, context) {
      const { workspaceSlug, ...patch } = input;
      const response = await workspaceSettingsService.updateWorkspaceSettings(
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

function buildWorkspaceSettingsActions({ workspaceSettingsService } = {}) {
  if (!workspaceSettingsService) throw new TypeError("buildWorkspaceSettingsActions requires workspaceSettingsService.");
  return workspaceSettingsActionSpecifications.map(({ run, ...definition }) => Object.freeze({
    ...definition,
    execute(input, context) {
      return run(workspaceSettingsService, input, context);
    }
  }));
}

export { workspaceSettingsActionSpecifications, buildWorkspaceSettingsActions };
