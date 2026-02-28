import { buildRoutes as buildChatAdapterRoutes } from "@jskit-ai/chat-fastify-routes";
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";

function buildRoutes(controllers, options = {}) {
  return buildChatAdapterRoutes(controllers, {
    ...(options || {}),
    withStandardErrorResponses
  });
}

export { buildRoutes };
