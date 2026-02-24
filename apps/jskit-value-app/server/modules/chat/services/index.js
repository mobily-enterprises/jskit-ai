import { createService as createChatService, __testables as chatServiceTestables } from "./chat.service.js";
import {
  createService as createChatRealtimeService,
  __testables as chatRealtimeServiceTestables
} from "./realtime.service.js";

function createService(options = {}) {
  const source = options && typeof options === "object" ? options : {};
  const chatServiceOptions =
    source.chatServiceOptions && typeof source.chatServiceOptions === "object" ? source.chatServiceOptions : source;
  const chatRealtimeServiceOptions =
    source.chatRealtimeServiceOptions && typeof source.chatRealtimeServiceOptions === "object"
      ? source.chatRealtimeServiceOptions
      : source;
  const chatRealtimeService = source.chatRealtimeService ?? createChatRealtimeService(chatRealtimeServiceOptions);
  const chatService =
    source.chatService ??
    createChatService({
      ...chatServiceOptions,
      chatRealtimeService
    });

  return {
    chatService,
    chatRealtimeService
  };
}

const __testables = Object.freeze({
  chatServiceTestables,
  chatRealtimeServiceTestables
});

export { createService, __testables };
