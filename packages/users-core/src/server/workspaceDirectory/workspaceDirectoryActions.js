import {
  EMPTY_INPUT_VALIDATOR,
  requireAuthenticated,
  resolveRequest,
  resolveUser
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { workspaceResource } from "../../shared/resources/workspaceResource.js";

const workspaceDirectoryActions = Object.freeze([
  {
    id: "workspace.workspaces.list",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    consoleUsersOnly: false,
    input: EMPTY_INPUT_VALIDATOR,
    output: workspaceResource.operations.list.output,
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "workspace.workspaces.list"
    },
    observability: {},
    async execute(input, context, deps) {
      return {
        items: await deps.workspaceService.listWorkspacesForUser(resolveUser(context, input), {
          request: resolveRequest(context)
        }),
        nextCursor: null
      };
    }
  }
]);

export { workspaceDirectoryActions };
