import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { userSettingsResource } from "../../shared/resources/userSettingsResource.js";

function bootAccountNotificationsRoutes(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("bootAccountNotificationsRoutes requires application make().");
  }

  const router = app.make("jskit.http.router");

  router.register(
    "PATCH",
    "/api/settings/notifications",
    {
      auth: "required",
      meta: {
        tags: ["settings"],
        summary: "Update notification settings"
      },
      bodyValidator: userSettingsResource.operations.notificationsUpdate.bodyValidator,
      responseValidators: withStandardErrorResponses(
        {
          200: userSettingsResource.operations.view.outputValidator
        },
        { includeValidation400: true }
      )
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "settings.notifications.update",
        input: {
          payload: request.input.body
        }
      });
      reply.code(200).send(response);
    }
  );
}

export { bootAccountNotificationsRoutes };
