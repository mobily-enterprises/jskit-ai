import { buildRoutes as buildSocialAdapterRoutes } from "@jskit-ai/social-fastify-adapter";
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";

function buildRoutes(controllers, options = {}) {
  return buildSocialAdapterRoutes(controllers, {
    ...(options || {}),
    withStandardErrorResponses
  });
}

export { buildRoutes };
