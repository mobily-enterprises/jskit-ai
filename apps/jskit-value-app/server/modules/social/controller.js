import { createController as createSocialAdapterController } from "@jskit-ai/social-fastify-routes/server";

function createController(options = {}) {
  return createSocialAdapterController(options);
}

export { createController };
