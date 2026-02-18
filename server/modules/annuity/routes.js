import { schema } from "./schema.js";
import { withStandardErrorResponses } from "../api/schema.js";

function buildRoutes(controllers) {
  return [
    {
      path: "/api/annuityCalculator",
      method: "POST",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      permission: "history.write",
      schema: {
        tags: ["annuityCalculator"],
        summary: "Calculate annuity value and append history",
        body: schema.body,
        response: withStandardErrorResponses(
          {
            200: schema.response
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 30,
        timeWindow: "1 minute"
      },
      handler: controllers.annuity.calculate
    }
  ];
}

export { buildRoutes };
