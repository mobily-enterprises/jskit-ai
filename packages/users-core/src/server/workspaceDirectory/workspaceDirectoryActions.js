import {
  EMPTY_INPUT_VALIDATOR,
  resolveRequest
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { workspaceResource } from "../../shared/resources/workspaceResource.js";
import { resolveActionUser } from "../common/support/resolveActionUser.js";

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
    inputValidator: workspaceResource.operations.create.bodyValidator,
    outputValidator: workspaceResource.operations.create.outputValidator,
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
    inputValidator: EMPTY_INPUT_VALIDATOR,
    outputValidator: workspaceResource.operations.list.outputValidator,
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
  }
]);

export { workspaceDirectoryActions };
