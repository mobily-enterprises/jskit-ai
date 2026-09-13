import { pendingInvitationsAssistantOutput } from "../../shared/resources/workspaceAssistantOutputs.js";
import {
  emptyInputValidator
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { returnJsonApiData } from "@jskit-ai/http-runtime/shared";
import { workspaceMembersResource } from "../../shared/resources/workspaceMembersResource.js";
import { workspacePendingInvitationsResource } from "../../shared/resources/workspacePendingInvitationsResource.js";
import { createInviteDecisionEvents } from "../common/support/realtimeServiceEvents.js";
import { resolveActionUser } from "../common/support/resolveActionUser.js";

const WORKSPACE_INVITE_DECISION_EVENTS = createInviteDecisionEvents();

const workspacePendingInvitationsActionSpecifications = Object.freeze([
  {
    id: "workspace.invitation.resolve",
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["*"],
    permission: {
      require: "none"
    },
    input: workspacePendingInvitationsResource.operations.resolve.query,
    output: null,
    extensions: {
      assistant: {
        exclude: "Use the invitation screen; raw invitation tokens must not enter assistant arguments."
      }
    },
    idempotency: "none",
    audit: {
      actionName: "workspace.invitation.resolve"
    },
    observability: {},
    async run(workspacePendingInvitationsService, input, context) {
      return returnJsonApiData(
        await workspacePendingInvitationsService.resolveInviteByToken(input?.token, {
          context
        })
      );
    }
  },
  {
    id: "workspace.invitations.pending.list",
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["*"],
    permission: {
      require: "authenticated"
    },
    input: emptyInputValidator,
    output: null,
    extensions: {
      assistant: {
        description: "List pending workspace invitations for the signed-in user without invitation tokens.",
        output: pendingInvitationsAssistantOutput,
        transformResult: (result) => ({
          pendingInvites: result.value.pendingInvites.map(
            ({ id, workspaceId, workspaceSlug, workspaceName, roleSid, status, expiresAt }) =>
              ({ id, workspaceId, workspaceSlug, workspaceName, roleSid, status, expiresAt })
          )
        })
      }
    },
    idempotency: "none",
    audit: {
      actionName: "workspace.invitations.pending.list"
    },
    observability: {},
    async run(workspacePendingInvitationsService, input, context) {
      return returnJsonApiData({
        pendingInvites: await workspacePendingInvitationsService.listPendingInvitesForUser(resolveActionUser(context, input), {
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
    surfaces: ["*"],
    permission: {
      require: "authenticated"
    },
    input: workspaceMembersResource.operations.redeemInvite.body,
    output: null,
    extensions: {
      assistant: {
        exclude: "Use the authenticated invitation screen to accept or refuse; raw invitation tokens must not enter assistant arguments."
      }
    },
    idempotency: "optional",
    audit: {
      actionName: "workspace.invite.redeem"
    },
    observability: {},
    events: WORKSPACE_INVITE_DECISION_EVENTS,
    async run(workspacePendingInvitationsService, input, context) {
      const payload = input || {};
      const user = resolveActionUser(context, input);

      if (payload.decision === "accept") {
        return returnJsonApiData(await workspacePendingInvitationsService.acceptInviteByToken({
          user,
          token: payload.token
        }, {
          context
        }));
      }

      return returnJsonApiData(await workspacePendingInvitationsService.refuseInviteByToken({
        user,
        token: payload.token
      }, {
        context
      }));
    }
  }
]);

function buildWorkspacePendingInvitationsActions({ workspacePendingInvitationsService } = {}) {
  if (!workspacePendingInvitationsService) {
    throw new TypeError("buildWorkspacePendingInvitationsActions requires workspacePendingInvitationsService.");
  }
  return workspacePendingInvitationsActionSpecifications.map(({ run, ...definition }) => Object.freeze({
    ...definition,
    execute(input, context) {
      return run(workspacePendingInvitationsService, input, context);
    }
  }));
}

export { workspacePendingInvitationsActionSpecifications, buildWorkspacePendingInvitationsActions };
