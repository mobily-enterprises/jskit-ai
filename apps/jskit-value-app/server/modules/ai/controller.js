import { createController as createAssistantAdapterController } from "@jskit-ai/assistant-fastify-adapter";
import { AppError } from "@jskit-ai/server-runtime-core/errors";
import { hasPermission } from "../../lib/rbacManifest.js";

function createController(options = {}) {
  return createAssistantAdapterController({
    ...(options || {}),
    appErrorClass: AppError,
    hasPermissionFn: hasPermission
  });
}

export { createController };
