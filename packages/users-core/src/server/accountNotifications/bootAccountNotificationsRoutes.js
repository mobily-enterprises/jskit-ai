import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/contracts/errorResponses";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { notificationsPatchBodySchema } from "../../shared/resources/userSettingsResource.js";
import { settingsResponseValidator } from "../common/validators/settingsResponseValidator.js";

function bootAccountNotificationsRoutes(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("bootAccountNotificationsRoutes requires application make().");
  }

  const router = app.make(KERNEL_TOKENS.HttpRouter);

  router.register(
    "PATCH",
    "/api/settings/notifications",
    {
      auth: "required",
      meta: {
        tags: ["settings"],
        summary: "Update notification settings"
      },
      body: {
        schema: notificationsPatchBodySchema,
        normalize: normalizeObjectInput
      },
      response: withStandardErrorResponses(
        {
          200: { schema: settingsResponseValidator.schema }
        },
        { includeValidation400: true }
      )
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "settings.notifications.update",
        input: request.input.body
      });
      reply.code(200).send(response);
    }
  );
}

export { bootAccountNotificationsRoutes };
