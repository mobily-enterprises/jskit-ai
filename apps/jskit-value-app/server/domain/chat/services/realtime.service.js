import {
  createChatRealtimeService as createChatRealtimeCoreService,
  chatRealtimeServiceTestables as chatRealtimeCoreTestables
} from "@jskit-ai/chat-core";
import { REALTIME_EVENT_TYPES } from "../../../../shared/realtime/eventTypes.js";

function createService(options = {}) {
  return createChatRealtimeCoreService({
    ...(options || {}),
    realtimeEventTypes: REALTIME_EVENT_TYPES
  });
}

const __testables = chatRealtimeCoreTestables;

export { createService, __testables };
