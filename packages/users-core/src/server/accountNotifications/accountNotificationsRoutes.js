import { createJsonApiResourceRouteContract } from "@jskit-ai/http-runtime/shared/validators/jsonApiRouteTransport";
import { userSettingsContract } from "../../shared/resources/userSettingsResource.js";
import { resolveAccountSettingsResourceId } from "../common/support/accountSettingsJsonApiTransport.js";

/** @param {import("@jskit-ai/kernel/server/types").RuntimeRouter} router */
function registerAccountNotificationsRoutes(router) {
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
        body: userSettingsContract.operations.notificationsUpdate.body,
        output: userSettingsContract.operations.view.output,
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
