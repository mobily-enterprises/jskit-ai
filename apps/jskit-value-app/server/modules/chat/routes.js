import { buildRoutes as buildChatAdapterRoutes } from "@jskit-ai/chat-fastify-adapter";
import { withStandardErrorResponses } from "../api/schema.js";

function buildRoutes(controllers, options = {}) {
  return buildChatAdapterRoutes(controllers, {
    ...(options || {}),
    withStandardErrorResponses
  });
}

export { buildRoutes };
