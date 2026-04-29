import {
  EMPTY_INPUT_VALIDATOR,
  resolveRequest
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
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

const workspaceDirectoryActions = Object.freeze([
  {
    id: "workspace.workspaces.create",
    version: 1,
    kind: "command",
    channels: ["api", "assistant_tool", "automation", "internal"],
    surfacesFrom: "enabled",
    permission: {
      require: "authenticated"
    },
    input: workspaceResource.operations.create.body,
    output: workspaceResource.operations.create.output,
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
    async execute(input, context, deps) {
      return deps.workspaceService.createWorkspaceForAuthenticatedUser(resolveActionUser(context, input), input, {
        request: resolveRequest(context),
        context
      });
    }
  },
  {
    id: "workspace.workspaces.list",
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "enabled",
    permission: {
      require: "authenticated"
    },
    input: EMPTY_INPUT_VALIDATOR,
    output: workspaceResource.operations.list.output,
    idempotency: "none",
    audit: {
      actionName: "workspace.workspaces.list"
    },
    observability: {},
    async execute(input, context, deps) {
      return {
        items: await deps.workspaceService.listWorkspacesForAuthenticatedUser(resolveActionUser(context, input), {
          request: resolveRequest(context),
          context
        }),
        nextCursor: null
      };
    }
  },
  {
    id: "workspace.workspaces.read",
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "workspace",
    permission: {
      require: "any",
      permissions: ["workspace.settings.view", "workspace.settings.update"]
    },
    input: workspaceSlugParamsValidator,
    output: workspaceResource.operations.view.output,
    idempotency: "none",
    audit: {
      actionName: "workspace.workspaces.read"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.workspaceService.getWorkspaceForAuthenticatedUser(
        resolveActionUser(context, input),
        input.workspaceSlug,
        {
          request: resolveRequest(context),
          context
        }
      );
    }
  },
  {
    id: "workspace.workspaces.update",
    version: 1,
    kind: "command",
    channels: ["api", "assistant_tool", "automation", "internal"],
    surfacesFrom: "workspace",
    permission: {
      require: "all",
      permissions: ["workspace.settings.update"]
    },
    input: workspaceUpdateInputValidator,
    output: workspaceResource.operations.patch.output,
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
    async execute(input, context, deps) {
      const { workspaceSlug, ...patch } = input;
      return deps.workspaceService.updateWorkspaceForAuthenticatedUser(
        resolveActionUser(context, input),
        workspaceSlug,
        patch,
        {
          request: resolveRequest(context),
          context
        }
      );
    }
  }
]);

export { workspaceDirectoryActions };
