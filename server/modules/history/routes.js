import { historyQuerySchema, historyListResponseSchema } from "./schemas.js";
import { withStandardErrorResponses } from "../api/schemas.js";

function buildHistoryRoutes(controllers) {
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
        querystring: historyQuerySchema,
        response: withStandardErrorResponses(
          {
            200: historyListResponseSchema
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

export { buildHistoryRoutes };
