import { createController as createSettingsAdapterController } from "@jskit-ai/settings-fastify-adapter";
import { resolveSurfaceFromPathname } from "../../../shared/surfacePaths.js";

function createController(options = {}) {
  return createSettingsAdapterController({
    ...(options && typeof options === "object" ? options : {}),
    resolveSurfaceFromPathname
  });
}

export { createController };
