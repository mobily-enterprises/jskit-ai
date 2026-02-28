import { createController as createSocialAdapterController } from "@jskit-ai/social-fastify-routes";

function createController(options = {}) {
  return createSocialAdapterController(options);
}

export { createController };
