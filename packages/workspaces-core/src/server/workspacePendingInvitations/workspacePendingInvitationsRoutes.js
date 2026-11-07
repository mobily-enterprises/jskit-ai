import { createJsonApiResourceRouteContract } from "@jskit-ai/http-runtime/shared/validators/jsonApiRouteTransport";
import { resolveActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { workspaceMembersContract } from "../../shared/resources/workspaceMembersResource.js";
import { workspacePendingInvitationsContract } from "../../shared/resources/workspacePendingInvitationsResource.js";
import {
  WORKSPACE_INVITATION_RESOLVE_TRANSPORT,
  WORKSPACE_INVITE_REDEEM_TRANSPORT,
  WORKSPACE_PENDING_INVITATIONS_TRANSPORT
} from "../../shared/jsonApiTransports.js";

/**
 * The JSON:API record id of a signed-in user's invitations: the user's id.
 * @param {unknown} _record
 * @param {{ request: object }} context The route transport's context.
 */
function resolveAuthenticatedUserRecordId(_record, context) {
  const userId = resolveActorId(null, context.request);
  if (userId) {
    return userId;
  }

  throw new Error("JSON:API response requires request.user.id.");
}

function resolveInviteResolutionRecordId(record) {
  const recordId = record?.id || record?.token;
  if (recordId != null && String(recordId).trim()) {
    return recordId;
  }
  return "workspace-invitation";
}

/** @param {import("@jskit-ai/kernel/server/types").RuntimeRouter} router */
function registerWorkspacePendingInvitationsRoutes(router) {
  router.register(
    "GET",
    "/api/workspace/invitations/resolve",
    {
      auth: "public",
      meta: {
        tags: ["workspace"],
        summary: "Resolve safe public workspace invitation metadata"
      },
      ...createJsonApiResourceRouteContract({
        ...WORKSPACE_INVITATION_RESOLVE_TRANSPORT,
        query: workspacePendingInvitationsContract.operations.resolve.query,
        output: workspacePendingInvitationsContract.operations.resolve.output,
        outputKind: "record",
        getRecordId: resolveInviteResolutionRecordId,
        includeValidation400: true
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "workspace.invitation.resolve",
        input: request.input.query
      });
      reply.code(200).send(response);
    }
  );

  router.register(
    "GET",
    "/api/workspace/invitations/pending",
    {
      auth: "required",
      meta: {
        tags: ["workspace"],
        summary: "List pending workspace invitations for authenticated user"
      },
      ...createJsonApiResourceRouteContract({
        ...WORKSPACE_PENDING_INVITATIONS_TRANSPORT,
        output: workspacePendingInvitationsContract.operations.list.output,
        outputKind: "record",
        getRecordId: resolveAuthenticatedUserRecordId
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "workspace.invitations.pending.list"
      });
      reply.code(200).send(response);
    }
  );

  router.register(
    "POST",
    "/api/workspace/invitations/redeem",
    {
      auth: "required",
      meta: {
        tags: ["workspace"],
        summary: "Accept or refuse a workspace invitation using an invite token"
      },
      ...createJsonApiResourceRouteContract({
        ...WORKSPACE_INVITE_REDEEM_TRANSPORT,
        body: workspaceMembersContract.operations.redeemInvite.body,
        output: workspaceMembersContract.operations.redeemInvite.output,
        outputKind: "record",
        getRecordId: resolveAuthenticatedUserRecordId,
        includeValidation400: true
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "workspace.invite.redeem",
        input: request.input.body
      });
      reply.code(200).send(response);
    }
  );
}

export { registerWorkspacePendingInvitationsRoutes };
