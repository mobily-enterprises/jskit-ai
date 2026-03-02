import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";
import { defaultMissingHandler } from "@jskit-ai/server-runtime-core/routeUtils";
import { schema } from "./schema.js";

function buildRoutes(controllers, { missingHandler } = {}) {
  const fallbackHandler = missingHandler || defaultMissingHandler;

  return [
    {
      path: "/api/health",
      method: "GET",
      auth: "public",
      schema: {
        tags: ["health"],
        summary: "Liveness probe for process health",
        response: withStandardErrorResponses({
          200: schema.response.health
        })
      },
      handler: controllers.health?.getHealth || fallbackHandler
    },
    {
      path: "/api/ready",
      method: "GET",
      auth: "public",
      schema: {
        tags: ["health"],
        summary: "Readiness probe for dependency health",
        response: withStandardErrorResponses({
          200: schema.response.readiness,
          503: schema.response.readiness
        })
      },
      handler: controllers.health?.getReadiness || fallbackHandler
    }
  ];
}

export { buildRoutes };
