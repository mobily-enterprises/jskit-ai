import { buildRoutes as buildAssistantAdapterRoutes } from "@jskit-ai/assistant-fastify-adapter";
import { withStandardErrorResponses } from "../api/schema.js";

function buildRoutes(controllers, options = {}) {
  return buildAssistantAdapterRoutes(controllers, {
    ...(options || {}),
    withStandardErrorResponses
  });
}

export { buildRoutes };
