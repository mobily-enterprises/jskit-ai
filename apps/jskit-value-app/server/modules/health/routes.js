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
