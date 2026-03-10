import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/contracts/errorResponses";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { workspaceSettingsSchema } from "@jskit-ai/users-core/shared/schemas/resources/workspaceSettingsSchema";
import { routeParams } from "../../shared/contracts/routeParams.js";

function registerWorkspaceSettingsRoutes(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("registerWorkspaceSettingsRoutes requires application make().");
  }

  const router = app.make(KERNEL_TOKENS.HttpRouter);
  const workspaceRouteTags = ["workspace"];

  router.register(
    "GET",
    "/api/w/:workspaceSlug/workspace/settings",
    {
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      meta: {
        tags: workspaceRouteTags,
        summary: "Get workspace settings and role catalog by workspace slug"
      },
      params: routeParams.workspaceSlug,
      response: withStandardErrorResponses({
        200: workspaceSettingsSchema.operations.view.output.schema
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
      workspacePolicy: "required",
      workspaceSurface: "app",
      meta: {
        tags: workspaceRouteTags,
        summary: "Update workspace settings by workspace slug"
      },
      params: routeParams.workspaceSlug,
      body: workspaceSettingsSchema.operations.patch.body,
      response: withStandardErrorResponses(
        {
          200: workspaceSettingsSchema.operations.view.output.schema
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

  router.register(
    "GET",
    "/api/admin/w/:workspaceSlug/workspace/settings",
    {
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      meta: {
        tags: workspaceRouteTags,
        summary: "Get workspace settings and role catalog by workspace slug"
      },
      params: routeParams.workspaceSlug,
      response: withStandardErrorResponses({
        200: workspaceSettingsSchema.operations.view.output.schema
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
    "/api/admin/w/:workspaceSlug/workspace/settings",
    {
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      meta: {
        tags: workspaceRouteTags,
        summary: "Update workspace settings by workspace slug"
      },
      params: routeParams.workspaceSlug,
      body: workspaceSettingsSchema.operations.patch.body,
      response: withStandardErrorResponses(
        {
          200: workspaceSettingsSchema.operations.view.output.schema
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

export {
  registerWorkspaceSettingsRoutes
};
