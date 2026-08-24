import { createJsonApiResourceRouteContract } from "@jskit-ai/http-runtime/shared/validators/jsonApiRouteTransport";
import { userSettingsResource } from "../../shared/resources/userSettingsResource.js";
import { resolveAccountSettingsResourceId } from "../common/support/accountSettingsJsonApiTransport.js";

function registerAccountNotificationsRoutes(router) {
  if (!router || typeof router.register !== "function") {
    throw new TypeError("registerAccountNotificationsRoutes requires router.register().");
  }

  router.register(
    "PATCH",
    "/api/settings/notifications",
    {
      auth: "required",
      meta: {
        tags: ["settings"],
        summary: "Update notification settings"
      },
      ...createJsonApiResourceRouteContract({
        requestType: "user-notification-settings",
        responseType: "user-settings",
        body: userSettingsResource.operations.notificationsUpdate.body,
        output: userSettingsResource.operations.view.output,
        outputKind: "record",
        getRecordId: resolveAccountSettingsResourceId,
        includeValidation400: true
      })
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

export { registerAccountNotificationsRoutes };
