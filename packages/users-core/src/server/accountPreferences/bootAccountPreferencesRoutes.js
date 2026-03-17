import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { userSettingsResource } from "../../shared/resources/userSettingsResource.js";

function bootAccountPreferencesRoutes(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("bootAccountPreferencesRoutes requires application make().");
  }

  const router = app.make(KERNEL_TOKENS.HttpRouter);

  router.register(
    "PATCH",
    "/api/settings/preferences",
    {
      auth: "required",
      meta: {
        tags: ["settings"],
        summary: "Update user preferences"
      },
      bodyValidator: userSettingsResource.operations.preferencesUpdate.bodyValidator,
      responseValidators: withStandardErrorResponses(
        {
          200: userSettingsResource.operations.view.outputValidator
        },
        { includeValidation400: true }
      )
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "settings.preferences.update",
        input: {
          payload: request.input.body
        }
      });
      reply.code(200).send(response);
    }
  );
}

export { bootAccountPreferencesRoutes };
