import { createService as createCommunicationsService } from "./service.js";

function createService(options = {}) {
  const service = createCommunicationsService(options);
  return {
    service
  };
}

export { buildRoutes } from "./routes.js";
export { createService };
