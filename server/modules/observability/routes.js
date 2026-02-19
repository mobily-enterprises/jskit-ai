import { withStandardErrorResponses } from "../api/schema.js";
import { schema } from "./schema.js";

function defaultMissingHandler(_request, reply) {
  reply.code(501).send({
    error: "Endpoint is not available in this server wiring."
  });
}

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
