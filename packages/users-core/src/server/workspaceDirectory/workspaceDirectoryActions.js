import {
  EMPTY_INPUT_CONTRACT,
  requireAuthenticated,
  resolveRequest,
  resolveUser
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";

const workspaceDirectoryActions = Object.freeze([
  {
    id: "workspace.workspaces.list",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    input: EMPTY_INPUT_CONTRACT,
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "workspace.workspaces.list"
    },
    observability: {},
    async execute(input, context, deps) {
      return {
        workspaces: await deps.workspaceService.listWorkspacesForUser(resolveUser(context, input), {
          request: resolveRequest(context)
        })
      };
    }
  }
]);

export { workspaceDirectoryActions };
