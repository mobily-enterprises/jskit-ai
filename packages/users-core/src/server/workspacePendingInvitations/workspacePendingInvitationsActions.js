import {
  EMPTY_INPUT_VALIDATOR,
  requireAuthenticated,
  resolveUser
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { workspacePendingInvitationsResource } from "../../shared/resources/workspacePendingInvitationsResource.js";
import { workspaceInviteResource } from "../../shared/resources/workspaceInviteResource.js";

const workspacePendingInvitationsActions = Object.freeze([
  {
    id: "workspace.invitations.pending.list",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    consoleUsersOnly: false,
    input: EMPTY_INPUT_VALIDATOR,
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
    consoleUsersOnly: false,
    input: workspaceInviteResource.operations.redeem.body,
    output: workspaceInviteResource.operations.redeem.output,
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
