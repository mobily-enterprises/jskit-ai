import { createController as createChatAdapterController } from "@jskit-ai/chat-fastify-adapter";
import { AppError } from "../../lib/errors.js";

function createController(options = {}) {
  return createChatAdapterController({
    ...(options || {}),
    appErrorClass: AppError
  });
}

export { createController };
