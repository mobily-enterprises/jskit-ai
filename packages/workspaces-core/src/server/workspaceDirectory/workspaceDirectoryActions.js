import {
  emptyInputValidator,
  resolveRequest
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { returnJsonApiData } from "@jskit-ai/http-runtime/shared";
import { composeSchemaDefinitions } from "@jskit-ai/kernel/shared/validators";
import { workspaceResource } from "../../shared/resources/workspaceResource.js";
import { workspaceSlugParamsValidator } from "../common/validators/routeParamsValidator.js";
import { resolveActionUser } from "../common/support/resolveActionUser.js";

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
    idempotency: "none",
    audit: {
      actionName: "workspace.workspaces.create"
    },
    observability: {},
    extensions: {
      assistant: {
        description: "Create a workspace for the authenticated user."
      }
    },
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
    idempotency: "optional",
    audit: {
      actionName: "workspace.workspaces.update"
    },
    observability: {},
    extensions: {
      assistant: {
        description: "Update workspace profile fields."
      }
    },
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
