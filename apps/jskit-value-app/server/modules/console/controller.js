import { createController as createConsoleAdapterController } from "@jskit-ai/console-fastify-adapter";

function createController(options = {}) {
  return createConsoleAdapterController(options && typeof options === "object" ? options : {});
}

export { createController };
