import { buildRoutes as buildAssistantAdapterRoutes } from "@jskit-ai/assistant-fastify-adapter";
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";

function buildRoutes(controllers, options = {}) {
  return buildAssistantAdapterRoutes(controllers, {
    ...(options || {}),
    withStandardErrorResponses
  });
}

export { buildRoutes };
