import { pendingInvitationsAssistantOutput } from "../../shared/resources/workspaceAssistantOutputs.js";
import {
  emptyInputValidator
} from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { workspaceMembersResource } from "../../shared/resources/workspaceMembersResource.js";
import { workspacePendingInvitationsResource } from "../../shared/resources/workspacePendingInvitationsResource.js";
import { createInviteDecisionEvents } from "../common/support/realtimeServiceEvents.js";
import { resolveActionUser } from "@jskit-ai/users-core/server/resolveActionUser";

const WORKSPACE_INVITE_DECISION_EVENTS = createInviteDecisionEvents();

/** @param {{ workspacePendingInvitationsService: import("./workspacePendingInvitationsService.js").WorkspacePendingInvitationsService }} dependencies */
function createWorkspacePendingInvitationsActions({ workspacePendingInvitationsService }) {
  return Object.freeze([
    Object.freeze({
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
      execute: (input, context) => workspacePendingInvitationsService.resolveInviteByToken(
        input.token,
        { context }
      )
    }),
    Object.freeze({
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
      execute: (input, context) => workspacePendingInvitationsService.listPendingInvitesResponse(
        resolveActionUser(context, input),
        { context }
      )
    }),
    Object.freeze({
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
      events: WORKSPACE_INVITE_DECISION_EVENTS,
      // The signed-in actor decides; a user named in the input never stands in for them.
      execute: (input, context) => workspacePendingInvitationsService.redeemInviteByToken(
        resolveActionUser(context),
        input,
        { context }
      )
    })
  ]);
}

export { createWorkspacePendingInvitationsActions };
