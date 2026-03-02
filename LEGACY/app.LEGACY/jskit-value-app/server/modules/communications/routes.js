import { buildRoutes as buildCommunicationsAdapterRoutes } from "@jskit-ai/communications-fastify-routes/server";
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";

function buildRoutes(controllers, options = {}) {
  return buildCommunicationsAdapterRoutes(controllers, {
    ...(options || {}),
    withStandardErrorResponses
  });
}

export { buildRoutes };
