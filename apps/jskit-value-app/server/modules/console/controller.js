import { createController as createConsoleAdapterController } from "@jskit-ai/console-fastify-adapter";
import { resolveSurfaceFromPathname } from "../../../shared/surfacePaths.js";

function createController(options = {}) {
  return createConsoleAdapterController({
    ...(options && typeof options === "object" ? options : {}),
    resolveSurfaceFromPathname
  });
}

export { createController };
