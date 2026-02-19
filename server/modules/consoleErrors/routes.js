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
      path: "/api/console/errors/browser/:errorId",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["console-errors"],
        summary: "Get browser error log entry by id",
        params: schema.params,
        response: withStandardErrorResponses(
          {
            200: schema.response.browserErrorSingle
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.consoleErrors?.getBrowserError || missingHandler
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
      path: "/api/console/errors/server/:errorId",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["console-errors"],
        summary: "Get server error log entry by id",
        params: schema.params,
        response: withStandardErrorResponses(
          {
            200: schema.response.serverErrorSingle
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.consoleErrors?.getServerError || missingHandler
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
    },
    {
      path: "/api/console/simulate/server-error",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["console-errors"],
        summary: "Simulate a server error for diagnostics",
        body: schema.body.simulateServerError,
        response: withStandardErrorResponses(
          {
            200: schema.response.simulateServerError
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 30,
        timeWindow: "1 minute"
      },
      handler: controllers.consoleErrors?.simulateServerError || missingHandler
    }
  ];
}

export { buildRoutes };
