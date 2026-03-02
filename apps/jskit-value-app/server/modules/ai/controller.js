import { createController as createAssistantAdapterController } from "@jskit-ai/assistant-fastify-routes/server";
import { AppError } from "@jskit-ai/server-runtime-core/errors";
import { hasPermission } from "@jskit-ai/rbac-core/server/lib/rbac";

function createController(options = {}) {
  return createAssistantAdapterController({
    ...(options || {}),
    appErrorClass: AppError,
    hasPermissionFn: hasPermission
  });
}

export { createController };
