import {
  emptyInputValidator,
  resolveRequest
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { returnJsonApiData } from "@jskit-ai/http-runtime/shared";
import { composeSchemaDefinitions } from "@jskit-ai/kernel/shared/validators";
import { workspaceResource } from "../../shared/resources/workspaceResource.js";
import { workspaceSlugParamsValidator } from "../common/validators/routeParamsValidator.js";
import { resolveActionUser } from "../common/support/resolveActionUser.js";

function workspaceAssistantSummary({ id, slug, name, ownerUserId, avatarUrl }) {
  return { id, slug, name, ownerUserId, avatarUrl };
}

const workspaceUpdateInputValidator = composeSchemaDefinitions([
  workspaceSlugParamsValidator,
  workspaceResource.operations.patch.body
], {
  mode: "patch",
  context: "workspaceDirectoryActions.workspaceUpdateInputValidator"
});

const workspaceDirectoryActionSpecifications = Object.freeze([
  {
    id: "workspace.workspaces.create",
    version: 1,
    kind: "command",
    channels: ["api", "assistant_tool", "automation", "internal"],
    surfaces: ["*"],
    permission: {
      require: "authenticated"
    },
    input: workspaceResource.operations.create.body,
    output: null,
    extensions: {
      assistant: {
        description: "Create a workspace for the signed-in user.",
        output: workspaceResource.operations.create.output,
        transformResult: (result) => workspaceAssistantSummary(result.value)
      }
    },
    idempotency: "none",
    audit: {
      actionName: "workspace.workspaces.create"
    },
    observability: {},
    async run(workspaceService, input, context) {
      return returnJsonApiData(await workspaceService.createWorkspaceForAuthenticatedUser(resolveActionUser(context, input), input, {
        request: resolveRequest(context),
        context
      }));
    }
  },
  {
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
        output: workspaceResource.operations.list.output,
        transformResult: (result) => ({
          items: result.value.items.map(({ id, slug, name, avatarUrl, roleSid, isAccessible }) =>
            ({ id, slug, name, avatarUrl, roleSid, isAccessible })),
          nextCursor: result.value.nextCursor
        })
      }
    },
    idempotency: "none",
    audit: {
      actionName: "workspace.workspaces.list"
    },
    observability: {},
    async run(workspaceService, input, context) {
      return returnJsonApiData({
        items: await workspaceService.listWorkspacesForAuthenticatedUser(resolveActionUser(context, input), {
          request: resolveRequest(context),
          context
        }),
        nextCursor: null
      });
    }
  },
  {
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
        output: workspaceResource.operations.view.output,
        transformResult: (result) => workspaceAssistantSummary(result.value)
      }
    },
    idempotency: "none",
    audit: {
      actionName: "workspace.workspaces.read"
    },
    observability: {},
    async run(workspaceService, input, context) {
      return returnJsonApiData(await workspaceService.getWorkspaceForAuthenticatedUser(
        resolveActionUser(context, input),
        input.workspaceSlug,
        {
          request: resolveRequest(context),
          context
        }
      ));
    }
  },
  {
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
        output: workspaceResource.operations.patch.output,
        transformResult: (result) => workspaceAssistantSummary(result.value)
      }
    },
    idempotency: "optional",
    audit: {
      actionName: "workspace.workspaces.update"
    },
    observability: {},
    async run(workspaceService, input, context) {
      const { workspaceSlug, ...patch } = input;
      return returnJsonApiData(await workspaceService.updateWorkspaceForAuthenticatedUser(
        resolveActionUser(context, input),
        workspaceSlug,
        patch,
        {
          request: resolveRequest(context),
          context
        }
      ));
    }
  }
]);

function buildWorkspaceDirectoryActions({ workspaceService } = {}) {
  if (!workspaceService) throw new TypeError("buildWorkspaceDirectoryActions requires workspaceService.");
  return workspaceDirectoryActionSpecifications.map(({ run, ...definition }) => Object.freeze({
    ...definition,
    execute(input, context) {
      return run(workspaceService, input, context);
    }
  }));
}

export { workspaceDirectoryActionSpecifications, buildWorkspaceDirectoryActions };
