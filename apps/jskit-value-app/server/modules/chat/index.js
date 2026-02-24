import { createService as createChatService } from "./services/chat.service.js";
import { createService as createChatRealtimeService } from "./services/realtime.service.js";
import { createRepository as createChatRepository } from "./repositories/index.js";
import { resolveScopedServiceOptions } from "./lib/scopedServiceOptions.js";

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

function createRepository() {
  return createChatRepository();
}

export { createController } from "./controller.js";
export { buildRoutes } from "./routes.js";
export { createService, createRepository };
