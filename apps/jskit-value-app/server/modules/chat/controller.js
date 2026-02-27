import { createController as createChatAdapterController } from "@jskit-ai/chat-core";
import { AppError } from "@jskit-ai/server-runtime-core/errors";

function createController(options = {}) {
  return createChatAdapterController({
    ...(options || {}),
    appErrorClass: AppError
  });
}

export { createController };
