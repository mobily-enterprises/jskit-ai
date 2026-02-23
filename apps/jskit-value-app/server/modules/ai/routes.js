import { buildRoutes as buildAssistantAdapterRoutes } from "../../../../../packages/ai-agent/assistant-fastify-adapter/src/routes.js";
import { withStandardErrorResponses } from "../api/schema.js";

function buildRoutes(controllers, options = {}) {
  return buildAssistantAdapterRoutes(controllers, {
    ...(options || {}),
    withStandardErrorResponses
  });
}

export { buildRoutes };
