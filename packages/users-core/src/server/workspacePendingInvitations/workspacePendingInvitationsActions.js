import {
  EMPTY_INPUT_CONTRACT,
  requireAuthenticated,
  resolveUser
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { workspaceInviteRedeemCommand } from "../../shared/contracts/commands/workspaceInviteRedeemCommand.js";

const workspacePendingInvitationsActions = Object.freeze([
  {
    id: "workspace.invitations.pending.list",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    input: [EMPTY_INPUT_CONTRACT],
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
    input: [workspaceInviteRedeemCommand.operation.body],
    permission: requireAuthenticated,
    idempotency: "optional",
    audit: {
      actionName: "workspace.invite.redeem"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.workspacePendingInvitationsService.redeemInviteByToken({
        user: resolveUser(context, input),
        inviteToken: input.token,
        decision: input.decision
      });
    }
  }
]);

export { workspacePendingInvitationsActions };
