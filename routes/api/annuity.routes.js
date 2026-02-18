import { annuityCalculatorRequestBodySchema } from "../../lib/schemas/annuityCalculator.request.js";
import { annuityCalculatorResponseSchema } from "../../lib/schemas/annuityCalculator.response.js";
import { withStandardErrorResponses } from "./common.schemas.js";

function buildAnnuityRoutes(controllers) {
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
        body: annuityCalculatorRequestBodySchema,
        response: withStandardErrorResponses(
          {
            200: annuityCalculatorResponseSchema
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

export { buildAnnuityRoutes };
