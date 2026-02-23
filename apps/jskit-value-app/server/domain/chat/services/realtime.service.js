import {
  createService as createChatRealtimeCoreService,
  __testables as chatRealtimeCoreTestables
} from "../../../../../../packages/chat/chat-core/src/realtime.service.js";
import { REALTIME_EVENT_TYPES } from "../../../../shared/realtime/eventTypes.js";

function createService(options = {}) {
  return createChatRealtimeCoreService({
    ...(options || {}),
    realtimeEventTypes: REALTIME_EVENT_TYPES
  });
}

const __testables = chatRealtimeCoreTestables;

export { createService, __testables };
