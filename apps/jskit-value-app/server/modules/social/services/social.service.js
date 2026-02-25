import { createSocialService, socialServiceTestables } from "@jskit-ai/social-core";

function createService(options = {}) {
  const socialService = createSocialService(options);
  return socialService;
}

const __testables = {
  ...socialServiceTestables
};

export { createService, __testables };
