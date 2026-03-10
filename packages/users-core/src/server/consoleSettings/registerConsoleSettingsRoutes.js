import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/contracts/errorResponses";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { consoleSettingsRoutes as consoleSettingsSchema } from "./consoleSettingsRoutes.js";

function registerConsoleSettingsRoutes(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("registerConsoleSettingsRoutes requires application make().");
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
        200: { schema: consoleSettingsSchema.response.settings }
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
      body: {
        schema: consoleSettingsSchema.body.update,
        normalize: normalizeObjectInput
      },
      response: withStandardErrorResponses(
        {
          200: { schema: consoleSettingsSchema.response.settings }
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

export { registerConsoleSettingsRoutes };
