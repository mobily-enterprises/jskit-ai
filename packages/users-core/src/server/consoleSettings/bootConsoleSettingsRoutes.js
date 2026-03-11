import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/contracts/errorResponses";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { consoleSettingsResource } from "../../shared/resources/consoleSettingsResource.js";

function bootConsoleSettingsRoutes(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("bootConsoleSettingsRoutes requires application make().");
  }

  const router = app.make(KERNEL_TOKENS.HttpRouter);

  router.register(
    "GET",
    "/api/console/settings",
    {
      auth: "required",
      workspaceSurface: "console",
      meta: {
        tags: ["console", "settings"],
        summary: "Get console settings"
      },
      response: withStandardErrorResponses({
        200: consoleSettingsResource.operations.view.output
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "console.settings.read"
      });
      reply.code(200).send(response);
    }
  );

  router.register(
    "PATCH",
    "/api/console/settings",
    {
      auth: "required",
      workspaceSurface: "console",
      meta: {
        tags: ["console", "settings"],
        summary: "Update console settings"
      },
      body: consoleSettingsResource.operations.replace.body,
      response: withStandardErrorResponses(
        {
          200: consoleSettingsResource.operations.view.output
        },
        { includeValidation400: true }
      )
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "console.settings.update",
        input: request.input.body
      });
      reply.code(200).send(response);
    }
  );
}

export { bootConsoleSettingsRoutes };
