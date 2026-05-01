import {
  emptyInputValidator
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { returnJsonApiData } from "@jskit-ai/http-runtime/shared";
import { workspaceMembersResource } from "../../shared/resources/workspaceMembersResource.js";
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
    input: emptyInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: "workspace.invitations.pending.list"
    },
    observability: {},
    async execute(input, context, deps) {
      return returnJsonApiData({
        pendingInvites: await deps.workspacePendingInvitationsService.listPendingInvitesForUser(resolveActionUser(context, input), {
          context
        })
      });
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
    input: workspaceMembersResource.operations.redeemInvite.body,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: "workspace.invite.redeem"
    },
    observability: {},
    async execute(input, context, deps) {
      const payload = input || {};
      const user = resolveActionUser(context, input);

      if (payload.decision === "accept") {
        return returnJsonApiData(await deps.workspacePendingInvitationsService.acceptInviteByToken({
          user,
          token: payload.token
        }, {
          context
        }));
      }

      return returnJsonApiData(await deps.workspacePendingInvitationsService.refuseInviteByToken({
        user,
        token: payload.token
      }, {
        context
      }));
    }
  }
]);

export { workspacePendingInvitationsActions };
