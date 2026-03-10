import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/contracts/errorResponses";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { settingsRoutesContract as settingsSchema } from "../common/contracts/settingsRoutesContract.js";

function registerAccountPreferencesRoutes(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("registerAccountPreferencesRoutes requires application make().");
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
      body: {
        schema: settingsSchema.body.preferences,
        normalize: normalizeObjectInput
      },
      response: withStandardErrorResponses(
        {
          200: { schema: settingsSchema.response }
        },
        { includeValidation400: true }
      )
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "settings.preferences.update",
        input: request.input.body
      });
      reply.code(200).send(response);
    }
  );
}

export { registerAccountPreferencesRoutes };
