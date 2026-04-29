import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { userSettingsResource } from "../../shared/resources/userSettingsResource.js";

function bootAccountPreferencesRoutes(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("bootAccountPreferencesRoutes requires application make().");
  }

  const router = app.make("jskit.http.router");

  router.register(
    "PATCH",
    "/api/settings/preferences",
    {
      auth: "required",
      meta: {
        tags: ["settings"],
        summary: "Update user preferences"
      },
      body: userSettingsResource.operations.preferencesUpdate.body,
      responses: withStandardErrorResponses(
        {
          200: userSettingsResource.operations.view.output
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

export { bootAccountPreferencesRoutes };
