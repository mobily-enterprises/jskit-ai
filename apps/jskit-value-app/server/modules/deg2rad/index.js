import { createService as createDeg2radService } from "./service.js";

function createService(options = {}) {
  const service = createDeg2radService(options);
  return {
    service
  };
}

export { createController } from "./controller.js";
export { buildRoutes } from "./routes.js";
export { schema } from "./schema.js";
export { createService };
