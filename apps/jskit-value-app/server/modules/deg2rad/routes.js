import { schema } from "./schema.js";
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";

function buildRoutes(controllers) {
  return [
    {
      path: "/api/deg2rad",
      method: "POST",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "app",
      permission: "history.write",
      schema: {
        tags: ["DEG2RAD"],
        summary: "DEG2RAD calculator: convert degrees to radians",
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
      handler: controllers.deg2rad.calculate
    }
  ];
}

export { buildRoutes };
