import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/contracts/errorResponses";
import { schema as consoleSettingsSchema } from "../schema/consoleSettingsSchema.js";

function normalizeObjectInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return {
    ...value
  };
}

function buildRoutes(controller) {
  if (!controller) {
    throw new Error("Console settings routes require controller instance.");
  }

  const handler = (name) => controller[name].bind(controller);

  return [
    {
      path: "/api/console/settings",
      method: "GET",
      auth: "required",
      workspaceSurface: "console",
      meta: {
        tags: ["console", "settings"],
        summary: "Get console settings"
      },
      response: withStandardErrorResponses({
        200: consoleSettingsSchema.response.settings
      }),
      handler: handler("get")
    },
    {
      path: "/api/console/settings",
      method: "PATCH",
      auth: "required",
      workspaceSurface: "console",
      meta: {
        tags: ["console", "settings"],
        summary: "Update console settings"
      },
      body: {
        schema: consoleSettingsSchema.body.update,
        normalize: normalizeObjectInput
      },
      response: withStandardErrorResponses(
        {
          200: consoleSettingsSchema.response.settings
        },
        { includeValidation400: true }
      ),
      handler: handler("update")
    }
  ];
}

export { buildRoutes };
