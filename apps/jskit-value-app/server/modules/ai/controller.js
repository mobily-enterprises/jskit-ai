import { createController as createAssistantAdapterController } from "../../../../../packages/ai-agent/assistant-fastify-adapter/src/controller.js";
import { AppError } from "../../lib/errors.js";
import { hasPermission } from "../../lib/rbacManifest.js";

function createController(options = {}) {
  return createAssistantAdapterController({
    ...(options || {}),
    appErrorClass: AppError,
    hasPermissionFn: hasPermission
  });
}

export { createController };
