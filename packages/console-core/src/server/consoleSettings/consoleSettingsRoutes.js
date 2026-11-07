import { createJsonApiResourceRouteContract } from "@jskit-ai/http-runtime/shared/validators/jsonApiRouteTransport";
import { consoleSettingsContract } from "../../shared/resources/consoleSettingsResource.js";

function resolveConsoleSettingsRecordId() {
  return "console-settings";
}

/** @param {import("@jskit-ai/kernel/server/types").RuntimeRouter} router */
function registerConsoleSettingsRoutes(router) {
  router.register(
    "GET",
    "/api/console/settings",
    {
      auth: "required",
      surface: "console",
      meta: {
        tags: ["console", "settings"],
        summary: "Get console settings"
      },
      ...createJsonApiResourceRouteContract({
        requestType: "console-settings",
        responseType: "console-settings",
        output: consoleSettingsContract.operations.view.output,
        outputKind: "record",
        getRecordId: resolveConsoleSettingsRecordId
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
      surface: "console",
      meta: {
        tags: ["console", "settings"],
        summary: "Update console settings"
      },
      ...createJsonApiResourceRouteContract({
        requestType: "console-settings",
        responseType: "console-settings",
        body: consoleSettingsContract.operations.replace.body,
        output: consoleSettingsContract.operations.view.output,
        outputKind: "record",
        getRecordId: resolveConsoleSettingsRecordId,
        includeValidation400: true
      })
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
