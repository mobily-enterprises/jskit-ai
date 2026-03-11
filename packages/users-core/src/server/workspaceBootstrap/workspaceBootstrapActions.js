import {
  allowPublic,
  resolveRequest,
  resolveUser
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { workspacePendingInvitationsResource } from "../../shared/schemas/resources/workspacePendingInvitationsResource.js";
import { workspaceBootstrapResource } from "../../shared/schemas/resources/workspaceBootstrapResource.js";

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
    input: workspaceBootstrapResource.operations.view.input,
    output: workspaceBootstrapResource.operations.view.output,
    permission: allowPublic,
    idempotency: "none",
    audit: {
      actionName: "workspace.bootstrap.read"
    },
    observability: {},
    async execute(input, context, deps) {
      const user = resolveUser(context, input);
      const pendingInvites =
        deps.workspaceTenancyEnabled && user
          ? normalizePendingInvites(await deps.workspacePendingInvitationsService.listPendingInvitesForUser(user))
          : [];
      return deps.workspaceService.buildBootstrapPayload({
        request: resolveRequest(context),
        user,
        workspaceSlug: input.workspaceSlug,
        pendingInvites
      });
    }
  }
]);

export { workspaceBootstrapActions };
