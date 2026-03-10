import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/contracts/errorResponses";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { workspaceRoutesContract as workspaceSchema } from "../common/contracts/workspaceRoutesContract.js";

function registerWorkspaceDirectoryRoutes(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("registerWorkspaceDirectoryRoutes requires application make().");
  }

  const router = app.make(KERNEL_TOKENS.HttpRouter);

  router.register(
    "GET",
    "/api/workspaces",
    {
      auth: "required",
      meta: {
        tags: ["workspace"],
        summary: "List workspaces visible to authenticated user"
      },
      response: withStandardErrorResponses({
        200: { schema: workspaceSchema.response.workspacesList }
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "workspace.workspaces.list"
      });
      reply.code(200).send(response);
    }
  );
}

export { registerWorkspaceDirectoryRoutes };
