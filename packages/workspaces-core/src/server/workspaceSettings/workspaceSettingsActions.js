import { composeSchemaDefinitions } from "@jskit-ai/kernel/shared/validators";
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

/** @param {{ workspaceSettingsService: import("./workspaceSettingsService.js").WorkspaceSettingsService }} dependencies */
function createWorkspaceSettingsActions({ workspaceSettingsService }) {
  return Object.freeze([
    Object.freeze({
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
      extensions: {
        assistant: {
          description: "Read the active workspace appearance and invitation settings.",
          output: workspaceSettingsResource.operations.view.output,
          transformResult: (result) => result.value
        }
      },
      idempotency: "none",
      execute: (input, context) => workspaceSettingsService.getWorkspaceSettings(
        resolveWorkspace(context, input),
        { context }
      )
    }),
    Object.freeze({
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
      extensions: {
        assistant: {
          description: "Update the active workspace appearance and invitation settings.",
          output: workspaceSettingsResource.operations.patch.output,
          transformResult: (result) => result.value
        }
      },
      idempotency: "optional",
      events: WORKSPACE_SETTINGS_CHANGED_EVENTS,
      execute: (input, context) => workspaceSettingsService.updateWorkspaceSettings(
        resolveWorkspace(context, input),
        input,
        { context }
      )
    })
  ]);
}

export { createWorkspaceSettingsActions };
