import { createController as createChatAdapterController } from "../../../../../packages/chat/chat-fastify-adapter/src/controller.js";
import { AppError } from "../../lib/errors.js";

function createController(options = {}) {
  return createChatAdapterController({
    ...(options || {}),
    appErrorClass: AppError
  });
}

export { createController };
