import { createController as createSocialAdapterController } from "@jskit-ai/social-core";

function createController(options = {}) {
  return createSocialAdapterController(options);
}

export { createController };
