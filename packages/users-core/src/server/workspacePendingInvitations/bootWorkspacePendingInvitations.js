import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { workspaceMembersResource } from "../../shared/resources/workspaceMembersResource.js";
import { workspacePendingInvitationsResource } from "../../shared/resources/workspacePendingInvitationsResource.js";

function bootWorkspacePendingInvitations(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("bootWorkspacePendingInvitations requires application make().");
  }

  const router = app.make(KERNEL_TOKENS.HttpRouter);

  router.register(
    "GET",
    "/api/workspace/invitations/pending",
    {
      auth: "required",
      meta: {
        tags: ["workspace"],
        summary: "List pending workspace invitations for authenticated user"
      },
      responseValidators: withStandardErrorResponses({
        200: workspacePendingInvitationsResource.operations.list.outputValidator
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
      bodyValidator: workspaceMembersResource.operations.redeemInvite.bodyValidator,
      responseValidators: withStandardErrorResponses(
        {
          200: workspaceMembersResource.operations.redeemInvite.outputValidator
        },
        { includeValidation400: true }
      )
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "workspace.invite.redeem",
        input: {
          payload: request.input.body
        }
      });
      reply.code(200).send(response);
    }
  );
}

export { bootWorkspacePendingInvitations };
