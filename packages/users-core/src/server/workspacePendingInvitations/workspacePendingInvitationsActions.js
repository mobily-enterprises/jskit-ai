import {
  EMPTY_INPUT_CONTRACT,
  requireAuthenticated,
  resolveUser
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { workspaceInviteRedeemCommand } from "../../shared/contracts/commands/workspaceInviteRedeemCommand.js";
import { mapPendingInvites } from "./workspacePendingInvitationsOutput.js";

const workspacePendingInvitationsActions = Object.freeze([
  {
    id: "workspace.invitations.pending.list",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    input: EMPTY_INPUT_CONTRACT,
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "workspace.invitations.pending.list"
    },
    observability: {},
    async execute(input, context, deps) {
      return {
        pendingInvites: mapPendingInvites(
          await deps.workspacePendingInvitationsService.listPendingInvitesForUser(resolveUser(context, input))
        )
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
    input: workspaceInviteRedeemCommand.operation.body,
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
