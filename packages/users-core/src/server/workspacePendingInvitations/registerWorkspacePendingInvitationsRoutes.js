import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/contracts/errorResponses";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { workspaceRoutesContract as workspaceSchema } from "../common/contracts/workspaceRoutesContract.js";

function registerWorkspacePendingInvitationsRoutes(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("registerWorkspacePendingInvitationsRoutes requires application make().");
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
        200: { schema: workspaceSchema.response.pendingInvites }
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
      body: {
        schema: workspaceSchema.body.redeemInvite,
        normalize: normalizeObjectInput
      },
      response: withStandardErrorResponses(
        {
          200: workspaceSchema.commands["workspace.invite.redeem"].operation.response
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

export { registerWorkspacePendingInvitationsRoutes };
