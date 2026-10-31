import { createJsonApiResourceRouteContract } from "@jskit-ai/http-runtime/shared/validators/jsonApiRouteTransport";
import { userSettingsResource } from "../../shared/resources/userSettingsResource.js";
import { resolveAccountSettingsResourceId } from "../common/support/accountSettingsJsonApiTransport.js";

/** @param {import("@jskit-ai/kernel/server/types").RuntimeHttp["router"]} router */
function registerAccountPreferencesRoutes(router) {

  router.register(
    "PATCH",
    "/api/settings/preferences",
    {
      auth: "required",
      meta: {
        tags: ["settings"],
        summary: "Update user preferences"
      },
      ...createJsonApiResourceRouteContract({
        requestType: "user-preferences",
        responseType: "user-settings",
        body: userSettingsResource.operations.preferencesUpdate.body,
        output: userSettingsResource.operations.view.output,
        outputKind: "record",
        getRecordId: resolveAccountSettingsResourceId,
        includeValidation400: true
      })
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
