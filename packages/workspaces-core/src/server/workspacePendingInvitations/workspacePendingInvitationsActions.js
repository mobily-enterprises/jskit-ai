import {
  EMPTY_INPUT_VALIDATOR
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { workspaceMembersResource } from "../../shared/resources/workspaceMembersResource.js";
import { workspacePendingInvitationsResource } from "../../shared/resources/workspacePendingInvitationsResource.js";
import { resolveActionUser } from "../common/support/resolveActionUser.js";

const workspacePendingInvitationsActions = Object.freeze([
  {
    id: "workspace.invitations.pending.list",
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "enabled",
    permission: {
      require: "authenticated"
    },
    input: EMPTY_INPUT_VALIDATOR,
    output: workspacePendingInvitationsResource.operations.list.output,
    idempotency: "none",
    audit: {
      actionName: "workspace.invitations.pending.list"
    },
    observability: {},
    async execute(input, context, deps) {
      return {
        pendingInvites: await deps.workspacePendingInvitationsService.listPendingInvitesForUser(resolveActionUser(context, input), {
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
    permission: {
      require: "authenticated"
    },
    input: {
      payload: workspaceMembersResource.operations.redeemInvite.body
    },
    output: workspaceMembersResource.operations.redeemInvite.output,
    idempotency: "optional",
    audit: {
      actionName: "workspace.invite.redeem"
    },
    observability: {},
    async execute(input, context, deps) {
      const payload = input.payload || {};
      const user = resolveActionUser(context, input);

      if (payload.decision === "accept") {
        return deps.workspacePendingInvitationsService.acceptInviteByToken({
          user,
          token: payload.token
        }, {
          context
        });
      }

      return deps.workspacePendingInvitationsService.refuseInviteByToken({
        user,
        token: payload.token
      }, {
        context
      });
    }
  }
]);

export { workspacePendingInvitationsActions };
