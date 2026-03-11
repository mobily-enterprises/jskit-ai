import {
  EMPTY_INPUT_CONTRACT,
  requireAuthenticated,
  resolveUser
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { workspaceInviteRedeemCommandResource } from "../../shared/workspaceInviteRedeemCommandResource.js";
import { workspacePendingInvitationsResource } from "../../shared/schemas/resources/workspacePendingInvitationsResource.js";

const workspacePendingInvitationsActions = Object.freeze([
  {
    id: "workspace.invitations.pending.list",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    input: EMPTY_INPUT_CONTRACT,
    output: workspacePendingInvitationsResource.operations.list.output,
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "workspace.invitations.pending.list"
    },
    observability: {},
    async execute(input, context, deps) {
      return {
        pendingInvites: await deps.workspacePendingInvitationsService.listPendingInvitesForUser(resolveUser(context, input))
      };
    }
  },
  {
    id: "workspace.invite.redeem",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    input: workspaceInviteRedeemCommandResource.operation.body,
    output: workspaceInviteRedeemCommandResource.operation.output,
    permission: requireAuthenticated,
    idempotency: "optional",
    audit: {
      actionName: "workspace.invite.redeem"
    },
    observability: {},
    async execute(input, context, deps) {
      const user = resolveUser(context, input);

      if (input.decision === "accept") {
        return deps.workspacePendingInvitationsService.acceptInviteByToken({
          user,
          token: input.token
        });
      }

      return deps.workspacePendingInvitationsService.refuseInviteByToken({
        user,
        token: input.token
      });
    }
  }
]);

export { workspacePendingInvitationsActions };
