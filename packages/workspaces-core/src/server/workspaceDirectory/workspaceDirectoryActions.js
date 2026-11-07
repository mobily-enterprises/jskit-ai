import { emptyInputValidator } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { composeSchemaDefinitions } from "@jskit-ai/kernel/shared/validators";
import { workspaceCrud } from "../../shared/resources/workspaceResource.js";
import { workspaceSlugParamsValidator } from "../common/validators/routeParamsValidator.js";
import { resolveActionUser } from "@jskit-ai/users-core/server/resolveActionUser";

function workspaceAssistantSummary({ id, slug, name, ownerUserId, avatarUrl }) {
  return { id, slug, name, ownerUserId, avatarUrl };
}

const workspaceUpdateInputValidator = composeSchemaDefinitions([
  workspaceSlugParamsValidator,
  workspaceCrud.operations.patch.body
], {
  mode: "patch",
  context: "workspaceDirectoryActions.workspaceUpdateInputValidator"
});

/** @param {{ workspaceService: import("../types.js").WorkspaceDirectoryService }} dependencies */
function createWorkspaceDirectoryActions({ workspaceService }) {
  return Object.freeze([
    Object.freeze({
      id: "workspace.workspaces.create",
      version: 1,
      kind: "command",
      channels: ["api", "assistant_tool", "automation", "internal"],
      surfaces: ["*"],
      permission: {
        require: "authenticated"
      },
      input: workspaceCrud.operations.create.body,
      output: null,
      extensions: {
        assistant: {
          description: "Create a workspace for the signed-in user.",
          output: workspaceCrud.operations.create.output,
          transformResult: (result) => workspaceAssistantSummary(result.value)
        }
      },
      execute: (input, context) => workspaceService.createWorkspaceForAuthenticatedUser(
        resolveActionUser(context, input),
        input,
        { context }
      )
    }),
    Object.freeze({
      id: "workspace.workspaces.list",
      version: 1,
      kind: "query",
      channels: ["api", "automation", "internal"],
      surfaces: ["*"],
      permission: {
        require: "authenticated"
      },
      input: emptyInputValidator,
      output: null,
      extensions: {
        assistant: {
          description: "List workspaces accessible to the signed-in user.",
          output: workspaceCrud.operations.list.output,
          transformResult: (result) => ({
            items: result.value.items.map(({ id, slug, name, avatarUrl, roleSid, isAccessible }) =>
              ({ id, slug, name, avatarUrl, roleSid, isAccessible })),
            nextCursor: result.value.nextCursor
          })
        }
      },
      execute: (input, context) => workspaceService.listWorkspacesForAuthenticatedUser(
        resolveActionUser(context, input),
        { context }
      )
    }),
    Object.freeze({
      id: "workspace.workspaces.read",
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
          description: "Read the active workspace profile.",
          output: workspaceCrud.operations.view.output,
          transformResult: (result) => workspaceAssistantSummary(result.value)
        }
      },
      execute: (input, context) => workspaceService.getWorkspaceForAuthenticatedUser(
        resolveActionUser(context, input),
        input.workspaceSlug,
        { context }
      )
    }),
    Object.freeze({
      id: "workspace.workspaces.update",
      version: 1,
      kind: "command",
      channels: ["api", "assistant_tool", "automation", "internal"],
      surfaces: ["*"],
      permission: {
        require: "all",
        permissions: ["workspace.settings.update"]
      },
      input: workspaceUpdateInputValidator,
      output: null,
      extensions: {
        assistant: {
          description: "Update the active workspace name or avatar URL.",
          output: workspaceCrud.operations.patch.output,
          transformResult: (result) => workspaceAssistantSummary(result.value)
        }
      },
      execute: (input, context) => workspaceService.updateWorkspaceForAuthenticatedUser(
        resolveActionUser(context, input),
        input.workspaceSlug,
        input,
        { context }
      )
    })
  ]);
}

export { createWorkspaceDirectoryActions };
