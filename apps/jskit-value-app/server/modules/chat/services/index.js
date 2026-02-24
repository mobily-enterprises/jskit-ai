import { createService as createChatService, __testables as chatServiceTestables } from "./chat.service.js";
import {
  createService as createChatRealtimeService,
  __testables as chatRealtimeServiceTestables
} from "./realtime.service.js";
import { resolveScopedServiceOptions } from "../lib/scopedServiceOptions.js";

function createService(options = {}) {
  const { source, chatServiceOptions, chatRealtimeServiceOptions } = resolveScopedServiceOptions(options);
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
