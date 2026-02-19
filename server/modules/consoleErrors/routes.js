import { withStandardErrorResponses } from "../api/schema.js";
import { schema } from "./schema.js";

function buildRoutes(controllers, { missingHandler }) {
  return [
    {
      path: "/api/console/errors/browser",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["console-errors"],
        summary: "List browser error logs",
        querystring: schema.query,
        response: withStandardErrorResponses(
          {
            200: schema.response.listBrowserErrors
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.consoleErrors?.listBrowserErrors || missingHandler
    },
    {
      path: "/api/console/errors/server",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["console-errors"],
        summary: "List server error logs",
        querystring: schema.query,
        response: withStandardErrorResponses(
          {
            200: schema.response.listServerErrors
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.consoleErrors?.listServerErrors || missingHandler
    },
    {
      path: "/api/console/errors/browser",
      method: "POST",
      auth: "public",
      csrfProtection: false,
      schema: {
        tags: ["console-errors"],
        summary: "Record browser-side JavaScript error",
        body: schema.body.recordBrowserError,
        response: withStandardErrorResponses(
          {
            200: schema.response.recordBrowserError
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 120,
        timeWindow: "1 minute"
      },
      handler: controllers.consoleErrors?.recordBrowserError || missingHandler
    }
  ];
}

export { buildRoutes };
