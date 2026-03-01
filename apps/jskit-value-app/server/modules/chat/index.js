import { createRepository as createChatRepository } from "./repositories/index.js";
import { createService } from "./services/index.js";

function createRepository() {
  return createChatRepository();
}

export { createController } from "./controller.js";
export { buildRoutes } from "./routes.js";
export { createService, createRepository };
