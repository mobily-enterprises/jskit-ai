import { createController as createSocialAdapterController } from "@jskit-ai/social-fastify-adapter";

function createController(options = {}) {
  return createSocialAdapterController(options);
}

export { createController };
