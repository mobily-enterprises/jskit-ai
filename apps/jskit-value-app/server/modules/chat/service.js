import { createService as createChatCoreService, __testables as chatCoreTestables } from "../../../../../packages/chat/chat-core/src/service.js";
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
