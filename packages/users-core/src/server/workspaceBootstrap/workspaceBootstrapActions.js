import {
  allowPublic,
  normalizeObject,
  OBJECT_INPUT_SCHEMA,
  resolveRequest,
  resolveUser
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";

const workspaceBootstrapActions = Object.freeze([
  {
    id: "workspace.bootstrap.read",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    input: { schema: OBJECT_INPUT_SCHEMA },
    permission: allowPublic,
    idempotency: "none",
    audit: {
      actionName: "workspace.bootstrap.read"
    },
    observability: {},
    async execute(input, context, deps) {
      const payload = normalizeObject(input);
      return deps.workspaceService.buildBootstrapPayload({
        request: resolveRequest(context),
        user: resolveUser(context, payload),
        workspaceSlug: payload.workspaceSlug
      });
    }
  }
]);

export { workspaceBootstrapActions };
