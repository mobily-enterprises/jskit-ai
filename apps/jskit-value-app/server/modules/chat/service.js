import { createChatService as createChatCoreService, chatServiceTestables as chatCoreTestables } from "@jskit-ai/chat-core";
import { AppError } from "../../lib/errors.js";
import { REALTIME_EVENT_TYPES } from "../../../shared/realtime/eventTypes.js";

function createService(options = {}) {
  return createChatCoreService({
    ...(options || {}),
    appErrorClass: AppError,
    realtimeEventTypes: REALTIME_EVENT_TYPES
  });
}

const __testables = chatCoreTestables;

export { createService, __testables };
