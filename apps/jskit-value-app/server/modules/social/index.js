import { createService as createSocialService } from "./services/social.service.js";
import { createRepository as createSocialRepository } from "./repositories/index.js";

function createService(options = {}) {
  const source = options && typeof options === "object" ? options : {};
  const socialServiceOptions =
    source.socialServiceOptions && typeof source.socialServiceOptions === "object"
      ? source.socialServiceOptions
      : source;

  const socialService = source.socialService || createSocialService(socialServiceOptions);

  return {
    socialService
  };
}

function createRepository() {
  return createSocialRepository();
}

export { createController } from "./controller.js";
export { buildRoutes } from "./routes.js";
export { createService, createRepository };
