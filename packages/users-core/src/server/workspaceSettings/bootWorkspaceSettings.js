import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { workspaceSettingsResource } from "../../shared/resources/workspaceSettingsResource.js";
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
      visibility: "workspace",
      meta: {
        tags: ["workspace"],
        summary: "Get workspace settings and role catalog by workspace slug"
      },
      paramsValidator: routeParamsValidator,
      responseValidators: withStandardErrorResponses({
        200: workspaceSettingsResource.operations.view.outputValidator
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
      visibility: "workspace",
      meta: {
        tags: ["workspace"],
        summary: "Update workspace settings by workspace slug"
      },
      paramsValidator: routeParamsValidator,
      bodyValidator: workspaceSettingsResource.operations.patch.bodyValidator,
      responseValidators: withStandardErrorResponses(
        {
          200: workspaceSettingsResource.operations.patch.outputValidator
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
