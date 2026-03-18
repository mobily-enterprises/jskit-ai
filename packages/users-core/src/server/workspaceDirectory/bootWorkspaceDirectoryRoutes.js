import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { workspaceResource } from "../../shared/resources/workspaceResource.js";

function bootWorkspaceDirectoryRoutes(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("bootWorkspaceDirectoryRoutes requires application make().");
  }

  const router = app.make(KERNEL_TOKENS.HttpRouter);

  router.register(
    "POST",
    "/api/workspaces",
    {
      auth: "required",
      meta: {
        tags: ["workspace"],
        summary: "Create a workspace for the authenticated user"
      },
      bodyValidator: workspaceResource.operations.create.bodyValidator,
      responseValidators: withStandardErrorResponses(
        {
          200: workspaceResource.operations.create.outputValidator
        },
        { includeValidation400: true }
      )
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "workspace.workspaces.create",
        input: request.input.body
      });
      reply.code(200).send(response);
    }
  );

  router.register(
    "GET",
    "/api/workspaces",
    {
      auth: "required",
      meta: {
        tags: ["workspace"],
        summary: "List workspaces visible to authenticated user"
      },
      responseValidators: withStandardErrorResponses({
        200: workspaceResource.operations.list.outputValidator
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "workspace.workspaces.list",
        input: {}
      });
      reply.code(200).send(response);
    }
  );
}

export { bootWorkspaceDirectoryRoutes };
