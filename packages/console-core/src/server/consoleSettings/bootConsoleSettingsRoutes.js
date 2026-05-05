import { createJsonApiResourceRouteContract } from "@jskit-ai/http-runtime/shared/validators/jsonApiRouteTransport";
import { consoleSettingsResource } from "../../shared/resources/consoleSettingsResource.js";

function resolveConsoleSettingsRecordId() {
  return "console-settings";
}

function bootConsoleSettingsRoutes(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("bootConsoleSettingsRoutes requires application make().");
  }

  const router = app.make("jskit.http.router");

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
        output: consoleSettingsResource.operations.view.output,
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
        body: consoleSettingsResource.operations.replace.body,
        output: consoleSettingsResource.operations.view.output,
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

export { bootConsoleSettingsRoutes };
