import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { workspaceResource } from "../../shared/resources/workspaceResource.js";
import {
  USERS_WORKSPACE_SELF_CREATE_ENABLED_TOKEN
} from "../common/diTokens.js";

function bootWorkspaceDirectoryRoutes(app) {
  if (!app || typeof app.make !== "function" || typeof app.has !== "function") {
    throw new Error("bootWorkspaceDirectoryRoutes requires application make()/has().");
  }

  const router = app.make(KERNEL_TOKENS.HttpRouter);
  const workspaceSelfCreateEnabled = app.has(USERS_WORKSPACE_SELF_CREATE_ENABLED_TOKEN)
    ? app.make(USERS_WORKSPACE_SELF_CREATE_ENABLED_TOKEN) === true
    : false;

  if (workspaceSelfCreateEnabled) {
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
  }

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
