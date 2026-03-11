import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/contracts/errorResponses";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { workspacePendingInvitationsResource } from "../../shared/schemas/resources/workspacePendingInvitationsResource.js";
import { workspaceInviteRedeemCommandResource } from "../../shared/workspaceInviteRedeemCommandResource.js";

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
      response: withStandardErrorResponses({
        200: workspacePendingInvitationsResource.operations.list.output
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
      body: workspaceInviteRedeemCommandResource.operation.body,
      response: withStandardErrorResponses(
        {
          200: workspaceInviteRedeemCommandResource.operation.output
        },
        { includeValidation400: true }
      )
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
