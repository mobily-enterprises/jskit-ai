import { schema } from "./schemas.js";
import { withStandardErrorResponses } from "../api/schemas.js";

function buildRoutes(controllers) {
  return [
    {
      path: "/api/history",
      method: "GET",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      permission: "history.read",
      schema: {
        tags: ["history"],
        summary: "List authenticated user's calculation history",
        querystring: schema.query,
        response: withStandardErrorResponses(
          {
            200: schema.response.list
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 60,
        timeWindow: "1 minute"
      },
      handler: controllers.history.list
    }
  ];
}

export { buildRoutes };
