import { buildRoutes as buildChatAdapterRoutes } from "../../../../../packages/chat/chat-fastify-adapter/src/routes.js";
import { withStandardErrorResponses } from "../api/schema.js";

function buildRoutes(controllers, options = {}) {
  return buildChatAdapterRoutes(controllers, {
    ...(options || {}),
    withStandardErrorResponses
  });
}

export { buildRoutes };
