import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { workspaceResource } from "../../shared/resources/workspaceResource.js";
import { resolveWorkspaceRoutePath } from "../common/support/workspaceRoutePaths.js";
import { workspaceSlugParamsValidator } from "../common/validators/routeParamsValidator.js";
import { resolveDefaultWorkspaceRouteSurfaceIdFromAppConfig } from "../support/workspaceActionSurfaces.js";

function bootWorkspaceDirectoryRoutes(app) {
  if (!app || typeof app.make !== "function" || typeof app.has !== "function") {
    throw new Error("bootWorkspaceDirectoryRoutes requires application make()/has().");
  }

  const router = app.make("jskit.http.router");
  const appConfig = app.has("appConfig") ? app.make("appConfig") : {};
  const workspaceRouteSurfaceId = resolveDefaultWorkspaceRouteSurfaceIdFromAppConfig(appConfig);
  const workspaceSelfCreateEnabled = app.has("users.workspace.self-create.enabled")
    ? app.make("users.workspace.self-create.enabled") === true
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
        const body = request.input.body || {};
        const response = await request.executeAction({
          actionId: "workspace.workspaces.create",
          input: {
            name: body.name,
            slug: body.slug
          }
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

  router.register(
    "GET",
    resolveWorkspaceRoutePath("/"),
    {
      auth: "required",
      surface: workspaceRouteSurfaceId,
      visibility: "workspace",
      meta: {
        tags: ["workspace"],
        summary: "Get workspace profile by workspace slug"
      },
      paramsValidator: workspaceSlugParamsValidator,
      responseValidators: withStandardErrorResponses({
        200: workspaceResource.operations.view.outputValidator
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "workspace.workspaces.read",
        input: {
          workspaceSlug: request.input.params.workspaceSlug
        }
      });
      reply.code(200).send(response);
    }
  );

  router.register(
    "PATCH",
    resolveWorkspaceRoutePath("/"),
    {
      auth: "required",
      surface: workspaceRouteSurfaceId,
      visibility: "workspace",
      meta: {
        tags: ["workspace"],
        summary: "Update workspace profile by workspace slug"
      },
      paramsValidator: workspaceSlugParamsValidator,
      bodyValidator: workspaceResource.operations.patch.bodyValidator,
      responseValidators: withStandardErrorResponses(
        {
          200: workspaceResource.operations.patch.outputValidator
        },
        { includeValidation400: true }
      )
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "workspace.workspaces.update",
        input: {
          workspaceSlug: request.input.params.workspaceSlug,
          patch: request.input.body
        }
      });
      reply.code(200).send(response);
    }
  );
}

export { bootWorkspaceDirectoryRoutes };
