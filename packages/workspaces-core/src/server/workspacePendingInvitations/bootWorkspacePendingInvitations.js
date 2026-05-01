import { createJsonApiResourceRouteContract } from "@jskit-ai/http-runtime/shared/validators/jsonApiRouteTransport";
import { workspaceMembersResource } from "../../shared/resources/workspaceMembersResource.js";
import { workspacePendingInvitationsResource } from "../../shared/resources/workspacePendingInvitationsResource.js";
import {
  WORKSPACE_INVITE_REDEEM_TRANSPORT,
  WORKSPACE_PENDING_INVITATIONS_TRANSPORT
} from "../../shared/jsonApiTransports.js";

function resolveAuthenticatedUserRecordId(_record, context = {}) {
  const userId = context?.request?.user?.id;
  if (userId != null && String(userId).trim()) {
    return userId;
  }

  throw new Error("JSON:API response requires request.user.id.");
}

function bootWorkspacePendingInvitations(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("bootWorkspacePendingInvitations requires application make().");
  }

  const router = app.make("jskit.http.router");

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
        output: workspacePendingInvitationsResource.operations.list.output,
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
        body: workspaceMembersResource.operations.redeemInvite.body,
        output: workspaceMembersResource.operations.redeemInvite.output,
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

export { bootWorkspacePendingInvitations };
