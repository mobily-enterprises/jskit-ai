import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";
import { defaultMissingHandler } from "@jskit-ai/server-runtime-core/routeUtils";
import { schema } from "./schema.js";

function buildRoutes(controllers, { missingHandler } = {}) {
  const fallbackHandler = missingHandler || defaultMissingHandler;

  return [
    {
      path: "/api/metrics",
      method: "GET",
      auth: "public",
      csrfProtection: false,
      schema: {
        tags: ["observability"],
        summary: "Prometheus metrics endpoint",
        response: withStandardErrorResponses({
          200: schema.response.metrics
        })
      },
      handler: controllers.observability?.getMetrics || fallbackHandler
    }
  ];
}

export { buildRoutes };
