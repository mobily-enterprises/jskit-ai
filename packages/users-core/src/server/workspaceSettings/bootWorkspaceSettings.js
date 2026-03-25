import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { workspaceSettingsResource } from "../../shared/resources/workspaceSettingsResource.js";
import { resolveWorkspaceRoutePath } from "../common/support/workspaceRoutePaths.js";
import { workspaceSlugParamsValidator } from "../common/validators/routeParamsValidator.js";
import { resolveDefaultWorkspaceRouteSurfaceIdFromAppConfig } from "../support/workspaceActionSurfaces.js";

function bootWorkspaceSettings(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("bootWorkspaceSettings requires application make().");
  }

  const router = app.make("jskit.http.router");
  const appConfig = typeof app.has === "function" && app.has("appConfig") ? app.make("appConfig") : {};
  const workspaceRouteSurfaceId = resolveDefaultWorkspaceRouteSurfaceIdFromAppConfig(appConfig);

  router.register(
    "GET",
    resolveWorkspaceRoutePath("/settings"),
    {
      auth: "required",
      surface: workspaceRouteSurfaceId,
      visibility: "workspace",
      meta: {
        tags: ["workspace"],
        summary: "Get workspace settings and role catalog by workspace slug"
      },
      paramsValidator: workspaceSlugParamsValidator,
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
    resolveWorkspaceRoutePath("/settings"),
    {
      auth: "required",
      surface: workspaceRouteSurfaceId,
      visibility: "workspace",
      meta: {
        tags: ["workspace"],
        summary: "Update workspace settings by workspace slug"
      },
      paramsValidator: workspaceSlugParamsValidator,
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
          patch: request.input.body
        }
      });
      reply.code(200).send(response);
    }
  );
}

export { bootWorkspaceSettings };
