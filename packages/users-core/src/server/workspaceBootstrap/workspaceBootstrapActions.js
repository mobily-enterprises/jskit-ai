import {
  allowPublic,
  normalizeObject,
  OBJECT_INPUT_SCHEMA,
  resolveRequest,
  resolveUser
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { workspacePendingInvitationsResource } from "../../shared/schemas/resources/workspacePendingInvitationsResource.js";

function normalizePendingInvites(invites) {
  return workspacePendingInvitationsResource.operations.list.output.normalize({
    pendingInvites: invites
  }).pendingInvites;
}

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
      const user = resolveUser(context, payload);
      const pendingInvites =
        deps.workspaceTenancyEnabled && user
          ? normalizePendingInvites(await deps.workspacePendingInvitationsService.listPendingInvitesForUser(user))
          : [];
      return deps.workspaceService.buildBootstrapPayload({
        request: resolveRequest(context),
        user,
        workspaceSlug: payload.workspaceSlug,
        pendingInvites
      });
    }
  }
]);

export { workspaceBootstrapActions };
