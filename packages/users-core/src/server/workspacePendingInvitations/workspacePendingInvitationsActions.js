import {
  EMPTY_INPUT_VALIDATOR,
  resolveUser
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { workspacePendingInvitationsResource } from "../../shared/resources/workspacePendingInvitationsResource.js";
import { workspaceInviteResource } from "../../shared/resources/workspaceInviteResource.js";

const workspacePendingInvitationsActions = Object.freeze([
  {
    id: "workspace.invitations.pending.list",
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "enabled",
    consoleUsersOnly: false,
    permission: {
      require: "authenticated"
    },
    inputValidator: EMPTY_INPUT_VALIDATOR,
    outputValidator: workspacePendingInvitationsResource.operations.list.outputValidator,
    idempotency: "none",
    audit: {
      actionName: "workspace.invitations.pending.list"
    },
    observability: {},
    async execute(input, context, deps) {
      return {
        pendingInvites: await deps.workspacePendingInvitationsService.listPendingInvitesForUser(resolveUser(context, input), {
          context
        })
      };
    }
  },
  {
    id: "workspace.invite.redeem",
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "enabled",
    consoleUsersOnly: false,
    permission: {
      require: "authenticated"
    },
    inputValidator: workspaceInviteResource.operations.redeem.bodyValidator,
    outputValidator: workspaceInviteResource.operations.redeem.outputValidator,
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
        }, {
          context
        });
      }

      return deps.workspacePendingInvitationsService.refuseInviteByToken({
        user,
        token: input.token
      }, {
        context
      });
    }
  }
]);

export { workspacePendingInvitationsActions };
