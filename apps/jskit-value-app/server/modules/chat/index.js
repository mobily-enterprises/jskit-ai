import { createService as createChatService } from "./services/chat.service.js";
import { createService as createChatRealtimeService } from "./services/realtime.service.js";
import { createRepository as createChatRepository } from "./repositories/index.js";

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

function createRepository() {
  return createChatRepository();
}

export { createController } from "./controller.js";
export { buildRoutes } from "./routes.js";
export { createService, createRepository };
