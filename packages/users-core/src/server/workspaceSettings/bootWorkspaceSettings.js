import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { workspaceSettingsResource } from "../../shared/schemas/resources/workspaceSettingsResource.js";
import { routeParamsValidator } from "../common/validators/routeParamsValidator.js";

function bootWorkspaceSettings(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("bootWorkspaceSettings requires application make().");
  }

  const router = app.make(KERNEL_TOKENS.HttpRouter);

  router.register(
    "GET",
    "/api/w/:workspaceSlug/workspace/settings",
    {
      auth: "required",
      meta: {
        tags: ["workspace"],
        summary: "Get workspace settings and role catalog by workspace slug"
      },
      params: routeParamsValidator,
      response: withStandardErrorResponses({
        200: workspaceSettingsResource.operations.view.output
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "workspace.settings.read",
        input: {
          workspaceSlug: request.input.params.workspaceSlug
        }
      });
      reply.code(200).send(response);
    }
  );

  router.register(
    "PATCH",
    "/api/w/:workspaceSlug/workspace/settings",
    {
      auth: "required",
      meta: {
        tags: ["workspace"],
        summary: "Update workspace settings by workspace slug"
      },
      params: routeParamsValidator,
      body: workspaceSettingsResource.operations.patch.body,
      response: withStandardErrorResponses(
        {
          200: workspaceSettingsResource.operations.patch.output
        },
        { includeValidation400: true }
      )
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "workspace.settings.update",
        input: {
          workspaceSlug: request.input.params.workspaceSlug,
          ...request.input.body
        }
      });
      reply.code(200).send(response);
    }
  );
}

export { bootWorkspaceSettings };
