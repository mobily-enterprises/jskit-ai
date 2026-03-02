import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";
import { schema } from "./schema.js";

function buildRoutes(controllers, { missingHandler } = {}) {
  return [
    {
      path: "/api/alerts",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["alerts"],
        summary: "List alerts for authenticated user",
        querystring: schema.query,
        response: withStandardErrorResponses(
          {
            200: schema.response.list
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.alerts?.list || missingHandler
    },
    {
      path: "/api/alerts/read-all",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["alerts"],
        summary: "Mark all alerts as read for authenticated user",
        response: withStandardErrorResponses({
          200: schema.response.readAll
        })
      },
      handler: controllers.alerts?.markAllRead || missingHandler
    }
  ];
}

export { buildRoutes };
